//! V8 heap snapshots (.heapsnapshot from Chrome DevTools, Node's
//! `v8.writeHeapSnapshot()` / `--heapsnapshot-signal`): parse the flat
//! node / edge arrays, compute the dominator tree (Cooper–Harvey–Kennedy over
//! reverse postorder, weak edges excluded), retained sizes, distances from the
//! root, a per-class summary, instance / reference / retainer views, the
//! shortest retaining path, and a diff between two snapshots by object id.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct RawMeta {
    node_fields: Vec<String>,
    node_types: Vec<serde_json::Value>,
    edge_fields: Vec<String>,
    edge_types: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct RawSnapshotInfo {
    meta: RawMeta,
}

#[derive(Deserialize)]
struct RawSnapshot {
    snapshot: RawSnapshotInfo,
    nodes: Vec<u64>,
    edges: Vec<u64>,
    strings: Vec<String>,
}

const NO_DOM: u32 = u32::MAX;

pub struct Heap {
    node_types: Vec<String>,
    edge_types: Vec<String>,
    strings: Vec<String>,
    // Per node.
    ntype: Vec<u8>,
    name: Vec<u32>,
    id: Vec<u64>,
    self_size: Vec<u64>,
    first_edge: Vec<u32>,
    // Per edge.
    etype: Vec<u8>,
    ename: Vec<u32>,
    eto: Vec<u32>,
    // Derived.
    retained: Vec<u64>,
    idom: Vec<u32>,
    distance: Vec<u32>,
    /// BFS parent edge (for the path from the root).
    parent_edge: Vec<u32>,
    class: Vec<u32>,
    class_names: Vec<String>,
    // Retainers (reverse edges), CSR.
    ret_start: Vec<u32>,
    ret_edge: Vec<u32>,
    ret_from: Vec<u32>,
    pub total_size: u64,
}

fn type_names(v: &serde_json::Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

impl Heap {
    pub fn parse(json: &[u8]) -> Result<Heap, String> {
        let raw: RawSnapshot =
            serde_json::from_slice(json).map_err(|e| format!("Not a heap snapshot: {e}"))?;
        let m = &raw.snapshot.meta;
        let nf = m.node_fields.len();
        let ef = m.edge_fields.len();
        let pos = |fields: &[String], f: &str| {
            fields
                .iter()
                .position(|x| x == f)
                .ok_or_else(|| format!("snapshot has no {f} field"))
        };
        let (n_type, n_name, n_id, n_size, n_edges) = (
            pos(&m.node_fields, "type")?,
            pos(&m.node_fields, "name")?,
            pos(&m.node_fields, "id")?,
            pos(&m.node_fields, "self_size")?,
            pos(&m.node_fields, "edge_count")?,
        );
        let (e_type, e_name, e_to) = (
            pos(&m.edge_fields, "type")?,
            pos(&m.edge_fields, "name_or_index")?,
            pos(&m.edge_fields, "to_node")?,
        );
        let node_types = m.node_types.first().map(type_names).unwrap_or_default();
        let edge_types = m.edge_types.first().map(type_names).unwrap_or_default();
        if nf == 0
            || !raw.nodes.len().is_multiple_of(nf)
            || ef == 0
            || !raw.edges.len().is_multiple_of(ef)
        {
            return Err("Malformed snapshot arrays".into());
        }
        let n = raw.nodes.len() / nf;
        let e = raw.edges.len() / ef;
        let mut h = Heap {
            node_types,
            edge_types,
            strings: raw.strings,
            ntype: Vec::with_capacity(n),
            name: Vec::with_capacity(n),
            id: Vec::with_capacity(n),
            self_size: Vec::with_capacity(n),
            first_edge: Vec::with_capacity(n + 1),
            etype: Vec::with_capacity(e),
            ename: Vec::with_capacity(e),
            eto: Vec::with_capacity(e),
            retained: vec![],
            idom: vec![],
            distance: vec![],
            parent_edge: vec![],
            class: vec![],
            class_names: vec![],
            ret_start: vec![],
            ret_edge: vec![],
            ret_from: vec![],
            total_size: 0,
        };
        let mut edge = 0u32;
        for i in 0..n {
            let b = i * nf;
            h.ntype.push(raw.nodes[b + n_type] as u8);
            h.name.push(raw.nodes[b + n_name] as u32);
            h.id.push(raw.nodes[b + n_id]);
            h.self_size.push(raw.nodes[b + n_size]);
            h.first_edge.push(edge);
            edge += raw.nodes[b + n_edges] as u32;
        }
        h.first_edge.push(edge);
        if edge as usize != e {
            return Err(format!("Edge counts don't add up ({edge} vs {e})"));
        }
        for i in 0..e {
            let b = i * ef;
            h.etype.push(raw.edges[b + e_type] as u8);
            h.ename.push(raw.edges[b + e_name] as u32);
            h.eto.push((raw.edges[b + e_to] as usize / nf) as u32);
        }
        h.total_size = h.self_size.iter().sum();
        h.classify();
        h.retainers();
        h.analyze();
        Ok(h)
    }

    pub fn node_count(&self) -> usize {
        self.ntype.len()
    }

    fn type_name(&self, n: usize) -> &str {
        self.node_types
            .get(self.ntype[n] as usize)
            .map(String::as_str)
            .unwrap_or("?")
    }

    fn edge_type(&self, e: usize) -> &str {
        self.edge_types
            .get(self.etype[e] as usize)
            .map(String::as_str)
            .unwrap_or("?")
    }

    fn is_weak(&self, e: usize) -> bool {
        self.edge_type(e) == "weak"
    }

    pub fn node_name(&self, n: usize) -> &str {
        self.strings
            .get(self.name[n] as usize)
            .map(String::as_str)
            .unwrap_or("")
    }

    pub fn edge_name(&self, e: usize) -> String {
        match self.edge_type(e) {
            "element" | "hidden" => format!("[{}]", self.ename[e]),
            _ => self
                .strings
                .get(self.ename[e] as usize)
                .cloned()
                .unwrap_or_default(),
        }
    }

    /// DevTools-style constructor grouping.
    fn classify(&mut self) {
        let mut index: HashMap<String, u32> = HashMap::new();
        let mut class = Vec::with_capacity(self.node_count());
        for n in 0..self.node_count() {
            let t = self.type_name(n);
            let name = match t {
                "object" | "native" | "synthetic" => {
                    let s = self.node_name(n);
                    if s.is_empty() {
                        "(anonymous)".to_string()
                    } else {
                        s.to_string()
                    }
                }
                "closure" => "(closure)".into(),
                "array" => "(array)".into(),
                "string" | "concatenated string" | "sliced string" => "(string)".into(),
                "code" => "(compiled code)".into(),
                "hidden" => "(system)".into(),
                "number" => "(number)".into(),
                "regexp" => "RegExp".into(),
                "symbol" => "(symbol)".into(),
                "bigint" => "(bigint)".into(),
                "object shape" => "(object shape)".into(),
                other => format!("({other})"),
            };
            let next = index.len() as u32;
            let id = *index.entry(name.clone()).or_insert_with(|| {
                self.class_names.push(name);
                next
            });
            class.push(id);
        }
        self.class = class;
    }

    fn retainers(&mut self) {
        let n = self.node_count();
        let mut count = vec![0u32; n + 1];
        for &to in &self.eto {
            count[to as usize + 1] += 1;
        }
        for i in 0..n {
            count[i + 1] += count[i];
        }
        let mut fill = count.clone();
        let mut edge = vec![0u32; self.eto.len()];
        let mut from = vec![0u32; self.eto.len()];
        for src in 0..n {
            for e in self.first_edge[src]..self.first_edge[src + 1] {
                let to = self.eto[e as usize] as usize;
                let slot = fill[to] as usize;
                edge[slot] = e;
                from[slot] = src as u32;
                fill[to] += 1;
            }
        }
        self.ret_start = count;
        self.ret_edge = edge;
        self.ret_from = from;
    }

    fn analyze(&mut self) {
        let n = self.node_count();
        // Postorder DFS from the root (node 0) over strong edges.
        let mut order = Vec::with_capacity(n);
        let mut visited = vec![false; n];
        let mut stack: Vec<(u32, u32)> = vec![(0, self.first_edge[0])];
        visited[0] = true;
        while let Some(&mut (node, ref mut next)) = stack.last_mut() {
            let end = self.first_edge[node as usize + 1];
            let mut pushed = false;
            while *next < end {
                let e = *next as usize;
                *next += 1;
                if self.is_weak(e) {
                    continue;
                }
                let to = self.eto[e] as usize;
                if !visited[to] {
                    visited[to] = true;
                    stack.push((to as u32, self.first_edge[to]));
                    pushed = true;
                    break;
                }
            }
            if !pushed {
                order.push(node);
                stack.pop();
            }
        }
        // Reverse postorder number per node.
        let mut rpo = vec![u32::MAX; n];
        for (i, &node) in order.iter().rev().enumerate() {
            rpo[node as usize] = i as u32;
        }
        let mut idom = vec![NO_DOM; n];
        idom[0] = 0;
        let intersect = |idom: &Vec<u32>, mut a: u32, mut b: u32| -> u32 {
            while a != b {
                while rpo[a as usize] > rpo[b as usize] {
                    a = idom[a as usize];
                }
                while rpo[b as usize] > rpo[a as usize] {
                    b = idom[b as usize];
                }
            }
            a
        };
        let mut changed = true;
        while changed {
            changed = false;
            for &node in order.iter().rev().skip(1) {
                let node = node as usize;
                let mut new_idom = NO_DOM;
                for k in self.ret_start[node]..self.ret_start[node + 1] {
                    let k = k as usize;
                    if self.is_weak(self.ret_edge[k] as usize) {
                        continue;
                    }
                    let p = self.ret_from[k];
                    if idom[p as usize] == NO_DOM {
                        continue;
                    }
                    new_idom = if new_idom == NO_DOM {
                        p
                    } else {
                        intersect(&idom, p, new_idom)
                    };
                }
                if new_idom != NO_DOM && idom[node] != new_idom {
                    idom[node] = new_idom;
                    changed = true;
                }
            }
        }
        // Retained sizes: children before parents (postorder).
        let mut retained = self.self_size.clone();
        for &node in &order {
            let node = node as usize;
            if node != 0 && idom[node] != NO_DOM {
                retained[idom[node] as usize] += retained[node];
            }
        }
        // BFS distances and parent edges. Like DevTools, explore from the user
        // roots (the root's shortcut edges: global objects) first, so retaining
        // paths go through globals rather than VM internals (stack, handles)
        // whenever such a path exists; then from the GC root categories.
        let mut distance = vec![u32::MAX; n];
        let mut parent_edge = vec![u32::MAX; n];
        distance[0] = 0;
        let root_edges: Vec<usize> = (self.first_edge[0]..self.first_edge[1])
            .map(|e| e as usize)
            .collect();
        let (user, system): (Vec<usize>, Vec<usize>) = root_edges
            .into_iter()
            .filter(|&e| !self.is_weak(e))
            .partition(|&e| self.edge_type(e) == "shortcut");
        for phase in [user, system] {
            let mut queue = std::collections::VecDeque::new();
            for e in phase {
                let to = self.eto[e] as usize;
                if distance[to] == u32::MAX {
                    distance[to] = 1;
                    parent_edge[to] = e as u32;
                    queue.push_back(to as u32);
                }
            }
            while let Some(node) = queue.pop_front() {
                let node = node as usize;
                for e in self.first_edge[node]..self.first_edge[node + 1] {
                    let e = e as usize;
                    if self.is_weak(e) {
                        continue;
                    }
                    let to = self.eto[e] as usize;
                    if distance[to] == u32::MAX {
                        distance[to] = distance[node] + 1;
                        parent_edge[to] = e as u32;
                        queue.push_back(to as u32);
                    }
                }
            }
        }
        self.idom = idom;
        self.retained = retained;
        self.distance = distance;
        self.parent_edge = parent_edge;
    }

    fn reachable(&self, n: usize) -> bool {
        self.distance[n] != u32::MAX
    }

    /// Per class: count, shallow size, retained size (instances not dominated by a same-class instance).
    pub fn summary(&self) -> Vec<ClassRow> {
        let c = self.class_names.len();
        let mut rows: Vec<ClassRow> = self
            .class_names
            .iter()
            .enumerate()
            .map(|(i, name)| ClassRow {
                class: i as u32,
                name: name.clone(),
                count: 0,
                shallow: 0,
                retained: 0,
                min_distance: u32::MAX,
            })
            .collect();
        for n in 0..self.node_count() {
            if !self.reachable(n) || n == 0 {
                continue;
            }
            let r = &mut rows[self.class[n] as usize];
            r.count += 1;
            r.shallow += self.self_size[n];
            r.min_distance = r.min_distance.min(self.distance[n]);
        }
        // Walk the dominator tree keeping a count of same-class ancestors.
        let n = self.node_count();
        let mut children: Vec<Vec<u32>> = vec![Vec::new(); n];
        for v in 1..n {
            let d = self.idom[v];
            if d != NO_DOM && d as usize != v {
                children[d as usize].push(v as u32);
            }
        }
        let mut active = vec![0u32; c];
        let mut stack: Vec<(u32, bool)> = vec![(0, false)];
        while let Some((v, leaving)) = stack.pop() {
            let v = v as usize;
            let k = self.class[v] as usize;
            if leaving {
                active[k] -= 1;
                continue;
            }
            if v != 0 && active[k] == 0 {
                rows[k].retained += self.retained[v];
            }
            active[k] += 1;
            stack.push((v as u32, true));
            for &ch in &children[v] {
                stack.push((ch, false));
            }
        }
        rows.retain(|r| r.count > 0);
        rows.sort_by(|a, b| b.retained.cmp(&a.retained).then(b.shallow.cmp(&a.shallow)));
        rows
    }

    fn row(&self, n: usize) -> NodeRow {
        let mut name = self.node_name(n).to_string();
        if name.len() > 200 {
            let mut cut = 200;
            while !name.is_char_boundary(cut) {
                cut -= 1;
            }
            name.truncate(cut);
            name.push('…');
        }
        NodeRow {
            index: n as u32,
            id: self.id[n],
            name,
            kind: self.type_name(n).to_string(),
            class: self.class_names[self.class[n] as usize].clone(),
            shallow: self.self_size[n],
            retained: self.retained[n],
            distance: if self.reachable(n) {
                Some(self.distance[n])
            } else {
                None
            },
        }
    }

    pub fn instances(&self, class: u32, offset: usize, limit: usize) -> (usize, Vec<NodeRow>) {
        let mut all: Vec<usize> = (1..self.node_count())
            .filter(|&n| self.class[n] == class && self.reachable(n))
            .collect();
        all.sort_by(|a, b| self.retained[*b].cmp(&self.retained[*a]));
        (
            all.len(),
            all.into_iter()
                .skip(offset)
                .take(limit)
                .map(|n| self.row(n))
                .collect(),
        )
    }

    pub fn references(&self, n: usize, limit: usize) -> Vec<EdgeRow> {
        let mut out: Vec<EdgeRow> = (self.first_edge[n]..self.first_edge[n + 1])
            .map(|e| e as usize)
            .map(|e| EdgeRow {
                edge_type: self.edge_type(e).into(),
                edge_name: self.edge_name(e),
                node: self.row(self.eto[e] as usize),
            })
            .collect();
        out.sort_by_key(|r| std::cmp::Reverse(r.node.retained));
        out.truncate(limit);
        out
    }

    pub fn retainers_of(&self, n: usize, limit: usize) -> Vec<EdgeRow> {
        let mut out: Vec<EdgeRow> = (self.ret_start[n]..self.ret_start[n + 1])
            .map(|k| k as usize)
            .map(|k| EdgeRow {
                edge_type: self.edge_type(self.ret_edge[k] as usize).into(),
                edge_name: self.edge_name(self.ret_edge[k] as usize),
                node: self.row(self.ret_from[k] as usize),
            })
            .collect();
        out.sort_by(|a, b| {
            a.node
                .distance
                .unwrap_or(u32::MAX)
                .cmp(&b.node.distance.unwrap_or(u32::MAX))
        });
        out.truncate(limit);
        out
    }

    /// Shortest strong path from the root: (edge into the node, node), root first.
    pub fn path(&self, n: usize) -> Vec<EdgeRow> {
        let mut out = Vec::new();
        let mut cur = n;
        while cur != 0 && self.parent_edge[cur] != u32::MAX && out.len() < 100 {
            let e = self.parent_edge[cur] as usize;
            out.push(EdgeRow {
                edge_type: self.edge_type(e).into(),
                edge_name: self.edge_name(e),
                node: self.row(cur),
            });
            // The parent is the node whose edge range contains e.
            cur = self.first_edge.partition_point(|&f| f as usize <= e) - 1;
        }
        out.reverse();
        out
    }

    /// Objects in `self` (newer) that aren't in `older`, and the reverse, per class.
    pub fn diff(&self, older: &Heap) -> Vec<DiffRow> {
        let old_ids: std::collections::HashSet<u64> = (0..older.node_count())
            .filter(|&n| older.reachable(n))
            .map(|n| older.id[n])
            .collect();
        let new_ids: std::collections::HashSet<u64> = (0..self.node_count())
            .filter(|&n| self.reachable(n))
            .map(|n| self.id[n])
            .collect();
        let mut rows: HashMap<String, DiffRow> = HashMap::new();
        let blank = |name: &str| DiffRow {
            name: name.to_string(),
            added: 0,
            removed: 0,
            added_size: 0,
            removed_size: 0,
            class: None,
        };
        for n in 1..self.node_count() {
            if self.reachable(n) && !old_ids.contains(&self.id[n]) {
                let name = &self.class_names[self.class[n] as usize];
                let r = rows.entry(name.clone()).or_insert_with(|| blank(name));
                r.added += 1;
                r.added_size += self.self_size[n];
            }
        }
        for n in 1..older.node_count() {
            if older.reachable(n) && !new_ids.contains(&older.id[n]) {
                let name = &older.class_names[older.class[n] as usize];
                let r = rows.entry(name.clone()).or_insert_with(|| blank(name));
                r.removed += 1;
                r.removed_size += older.self_size[n];
            }
        }
        let class_of: HashMap<&str, u32> = self
            .class_names
            .iter()
            .enumerate()
            .map(|(i, s)| (s.as_str(), i as u32))
            .collect();
        let mut out: Vec<DiffRow> = rows
            .into_values()
            .map(|mut r| {
                r.class = class_of.get(r.name.as_str()).copied();
                r
            })
            .collect();
        out.sort_by(|a, b| {
            (b.added_size as i64 - b.removed_size as i64)
                .cmp(&(a.added_size as i64 - a.removed_size as i64))
        });
        out
    }

    /// New instances of a class compared with `older` (to inspect what leaked).
    pub fn new_instances(&self, older: &Heap, class: u32, limit: usize) -> Vec<NodeRow> {
        let old_ids: std::collections::HashSet<u64> = older.id.iter().copied().collect();
        let mut v: Vec<usize> = (1..self.node_count())
            .filter(|&n| {
                self.class[n] == class && self.reachable(n) && !old_ids.contains(&self.id[n])
            })
            .collect();
        v.sort_by(|a, b| self.retained[*b].cmp(&self.retained[*a]));
        v.into_iter().take(limit).map(|n| self.row(n)).collect()
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClassRow {
    pub class: u32,
    pub name: String,
    pub count: u64,
    pub shallow: u64,
    pub retained: u64,
    pub min_distance: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeRow {
    pub index: u32,
    pub id: u64,
    pub name: String,
    pub kind: String,
    pub class: String,
    pub shallow: u64,
    pub retained: u64,
    pub distance: Option<u32>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EdgeRow {
    pub edge_type: String,
    pub edge_name: String,
    pub node: NodeRow,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub name: String,
    /// Class index in the newer snapshot, when it still exists.
    pub class: Option<u32>,
    pub added: u64,
    pub removed: u64,
    pub added_size: u64,
    pub removed_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeapInfo {
    pub id: u32,
    pub nodes: usize,
    pub edges: usize,
    pub total_size: u64,
    pub reachable_size: u64,
}

// ── commands ──────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct HeapState {
    next: AtomicU32,
    heaps: Mutex<HashMap<u32, Arc<Heap>>>,
}

fn get(state: &HeapState, id: u32) -> Result<Arc<Heap>, String> {
    state
        .heaps
        .lock()
        .unwrap()
        .get(&id)
        .cloned()
        .ok_or_else(|| "snapshot is closed".into())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn heap_open(
    state: tauri::State<'_, HeapState>,
    path: String,
) -> Result<HeapInfo, String> {
    let heap = blocking(move || {
        let bytes = std::fs::read(PathBuf::from(&path)).map_err(|e| e.to_string())?;
        Heap::parse(&bytes)
    })
    .await?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let reachable_size = (0..heap.node_count())
        .filter(|&n| heap.reachable(n))
        .map(|n| heap.self_size[n])
        .sum();
    let info = HeapInfo {
        id,
        nodes: heap.node_count(),
        edges: heap.eto.len(),
        total_size: heap.total_size,
        reachable_size,
    };
    state.heaps.lock().unwrap().insert(id, Arc::new(heap));
    Ok(info)
}

#[tauri::command]
pub async fn heap_summary(
    state: tauri::State<'_, HeapState>,
    id: u32,
) -> Result<Vec<ClassRow>, String> {
    let h = get(&state, id)?;
    blocking(move || Ok(h.summary())).await
}

#[tauri::command]
pub async fn heap_instances(
    state: tauri::State<'_, HeapState>,
    id: u32,
    class: u32,
    offset: usize,
    limit: usize,
) -> Result<(usize, Vec<NodeRow>), String> {
    let h = get(&state, id)?;
    blocking(move || Ok(h.instances(class, offset, limit.min(1000)))).await
}

#[tauri::command]
pub fn heap_references(
    state: tauri::State<'_, HeapState>,
    id: u32,
    node: u32,
) -> Result<Vec<EdgeRow>, String> {
    let h = get(&state, id)?;
    Ok(h.references(node as usize, 500))
}

#[tauri::command]
pub fn heap_retainers(
    state: tauri::State<'_, HeapState>,
    id: u32,
    node: u32,
) -> Result<Vec<EdgeRow>, String> {
    let h = get(&state, id)?;
    Ok(h.retainers_of(node as usize, 200))
}

#[tauri::command]
pub fn heap_path(
    state: tauri::State<'_, HeapState>,
    id: u32,
    node: u32,
) -> Result<Vec<EdgeRow>, String> {
    let h = get(&state, id)?;
    Ok(h.path(node as usize))
}

#[tauri::command]
pub async fn heap_diff(
    state: tauri::State<'_, HeapState>,
    newer: u32,
    older: u32,
) -> Result<Vec<DiffRow>, String> {
    let (a, b) = (get(&state, newer)?, get(&state, older)?);
    blocking(move || Ok(a.diff(&b))).await
}

#[tauri::command]
pub async fn heap_new_instances(
    state: tauri::State<'_, HeapState>,
    newer: u32,
    older: u32,
    class: u32,
) -> Result<Vec<NodeRow>, String> {
    let (a, b) = (get(&state, newer)?, get(&state, older)?);
    blocking(move || Ok(a.new_instances(&b, class, 300))).await
}

#[tauri::command]
pub fn heap_close(state: tauri::State<'_, HeapState>, id: u32) {
    state.heaps.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hand-built graph: root → A → C, root → B → C, A → D (weak from B). C is dominated by root, D by A.
    fn tiny() -> Heap {
        let json = r#"{"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count"],"node_types":[["hidden","object","string"]],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["property","element","weak"]]}},
          "nodes":[0,0,1,0,2, 1,1,3,10,2, 1,2,5,20,2, 1,3,7,40,0, 1,4,9,80,0],
          "edges":[0,5,5, 0,6,10, 0,7,15, 0,8,20, 0,7,15, 2,9,20],
          "strings":["","A","B","C","D","a","b","c","d","w"]}"#;
        Heap::parse(json.as_bytes()).unwrap()
    }

    #[test]
    fn dominators_and_retained_sizes() {
        let h = tiny();
        assert_eq!(h.node_count(), 5);
        // A retains itself + D (C is shared with B); B retains itself only (D is weak from B).
        assert_eq!(h.retained, vec![150, 90, 20, 40, 80]);
        assert_eq!(h.idom, vec![0, 0, 0, 0, 1]);
        assert_eq!(h.distance, vec![0, 1, 1, 2, 2]);
        let s = h.summary();
        let a = s.iter().find(|r| r.name == "A").unwrap();
        assert_eq!((a.count, a.shallow, a.retained), (1, 10, 90));
        let path = h.path(4);
        assert_eq!(
            path.iter()
                .map(|p| (p.edge_name.as_str(), p.node.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("a", "A"), ("d", "D")]
        );
        let ret = h.retainers_of(3, 10);
        assert_eq!(ret.len(), 2);
        assert_eq!(
            h.references(2, 10)
                .iter()
                .map(|e| e.edge_type.as_str())
                .collect::<Vec<_>>(),
            vec!["weak", "property"]
        );
    }

    #[test]
    fn real_node_snapshots_find_the_leak() {
        // Two snapshots from a real Node process: 5,000 LeakyThing objects added in between.
        if std::process::Command::new("node")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let dir = std::env::temp_dir().join(format!("gear-heap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = r#"
const v8 = require("v8");
class LeakyThing { constructor(i) { this.i = i; this.payload = "x".repeat(100) + i; this.blob = new Array(50).fill(i); } }
const cache = new Map();
globalThis.registry = { cache };
v8.writeHeapSnapshot("a.heapsnapshot");
for (let i = 0; i < 5000; i++) cache.set(i, new LeakyThing(i));
v8.writeHeapSnapshot("b.heapsnapshot");
"#;
        std::fs::write(dir.join("leak.js"), script).unwrap();
        let ok = std::process::Command::new("node")
            .arg("leak.js")
            .current_dir(&dir)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        let a = Heap::parse(&std::fs::read(dir.join("a.heapsnapshot")).unwrap()).unwrap();
        let b = Heap::parse(&std::fs::read(dir.join("b.heapsnapshot")).unwrap()).unwrap();
        let s = b.summary();
        let leaky = s
            .iter()
            .find(|r| r.name == "LeakyThing")
            .expect("LeakyThing class");
        assert_eq!(leaky.count, 5000);
        // Each one holds its payload string and its 50-element array.
        assert!(leaky.retained > leaky.shallow * 3, "{leaky:?}");
        assert!(!s.iter().any(|r| r.name == "LeakyThing" && r.count != 5000));
        assert!(a.summary().iter().all(|r| r.name != "LeakyThing"));
        // The diff names the leak first among user classes.
        let d = b.diff(&a);
        let row = d.iter().find(|r| r.name == "LeakyThing").unwrap();
        assert_eq!((row.added, row.removed), (5000, 0));
        // The path from the root goes through the global registry and the Map.
        let (count, inst) = b.instances(leaky.class, 0, 3);
        assert_eq!(count, 5000);
        let path = b.path(inst[0].index as usize);
        let names: Vec<String> = path.iter().map(|p| p.edge_name.clone()).collect();
        assert!(names.iter().any(|n| n == "registry"), "{names:?}");
        assert!(names.iter().any(|n| n == "cache"), "{names:?}");
        assert_eq!(b.new_instances(&a, leaky.class, 10).len(), 10);
        let refs = b.references(inst[0].index as usize, 20);
        assert!(refs.iter().any(|r| r.edge_name == "payload"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
