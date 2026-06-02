//! The Chronicle event model. Every captured action becomes a `ChronicleEvent`
//! with a kind-specific `payload`, validated by the `EventPayload` enum so a
//! malformed event can never be written.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    Cmd {
        command: String,
        exit_code: Option<i32>,
        duration_ms: Option<u64>,
    },
    CmdOutput {
        blob: String,
        bytes: u64,
        truncated: bool,
    },
    File {
        path: String,
        op: String,
        before_blob: Option<String>,
        after_blob: Option<String>,
        added: u32,
        removed: u32,
    },
    Git {
        op: String,
        #[serde(rename = "reference")]
        reference: Option<String>,
        sha: Option<String>,
    },
    Agent {
        agent_id: String,
        step: String,
        tool: Option<String>,
        outcome: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChronicleEvent {
    pub ts: i64,
    pub session_id: String,
    pub actor: String,
    pub cwd: Option<String>,
    pub workspace_root: String,
    pub file_path: Option<String>,
    pub summary: String,
    pub payload: EventPayload,
    pub parent_id: Option<i64>,
}

impl ChronicleEvent {
    pub fn kind_str(&self) -> &'static str {
        match self.payload {
            EventPayload::Cmd { .. } => "cmd",
            EventPayload::CmdOutput { .. } => "cmd_output",
            EventPayload::File { .. } => "file",
            EventPayload::Git { .. } => "git",
            EventPayload::Agent { .. } => "agent",
        }
    }
}
