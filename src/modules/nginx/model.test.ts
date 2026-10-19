import { describe, expect, it } from "vitest";
import { lintNginx, loadConfig, NginxSyntaxError, parseListen, parseNginx, route, selectLocation, selectServer, serversOf, type Request } from "./model";

const main = `
user nginx;
events { worker_connections 1024; }
http {
  include mime.types;
  include conf.d/*.conf;
  add_header Strict-Transport-Security "max-age=31536000" always;
  upstream api_backend {
    server 10.0.0.1:8080 weight=2;
    server 10.0.0.2:8080;
  }
}
`;

const site = `
server {
  listen 80 default_server;
  server_name example.com www.example.com;
  root /var/www/site;
  rewrite ^/old/(.*)$ /new/$1 permanent;

  location = / { return 200 "home"; }
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://api_backend/v1/; }
  location ^~ /static/ { root /srv; }
  location ~* \\.(png|jpg)$ { add_header Cache-Control "max-age=86400"; }
  location /images { alias /data/img/; }
  location /docs/ {
    location ~ \\.pdf$ { return 403; }
  }
  location /legacy/ {
    rewrite ^/legacy/(.*)$ /docs/$1 last;
  }
}
server {
  listen 80;
  server_name *.example.com;
  return 301 https://example.com$request_uri;
}
server {
  listen 443 ssl;
  server_name ~^(?P<sub>.+)\\.example\\.org$;
  ssl_certificate /etc/cert.pem;
  ssl_protocols TLSv1 TLSv1.2;
  location / { proxy_pass http://127.0.0.1:3000; }
}
`;

const files: Record<string, string> = { "/etc/nginx/nginx.conf": main, "/etc/nginx/conf.d/site.conf": site, "/etc/nginx/mime.types": "types { text/html html; }" };
const loader = { read: async (p: string) => files[p] ?? null, list: async (dir: string) => Object.keys(files).filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes("/")).map((f) => f.slice(dir.length + 1)) };
const req = (over: Partial<Request>): Request => ({ host: "example.com", port: 80, uri: "/", args: "", scheme: "http", ...over });

describe("nginx", () => {
  it("parses directives, blocks, quotes and comments", () => {
    const t = parseNginx('a 1 "two words"; # c\nb { c ${x}y; d \'q;\'; }', "f");
    expect(t).toEqual([
      { name: "a", args: ["1", "two words"], file: "f", line: 1 },
      { name: "b", args: [], file: "f", line: 2, children: [{ name: "c", args: ["${x}y"], file: "f", line: 2 }, { name: "d", args: ["q;"], file: "f", line: 2 }] },
    ]);
    expect(() => parseNginx("a {\n b;", "f")).toThrow(NginxSyntaxError);
    expect(() => parseNginx("a b }", "f")).toThrow(/not terminated/);
  });

  it("expands includes with globs and reports missing files", async () => {
    const c = await loadConfig("/etc/nginx/nginx.conf", loader);
    expect(c.files).toEqual(["/etc/nginx/nginx.conf", "/etc/nginx/mime.types", "/etc/nginx/conf.d/site.conf"]);
    expect(serversOf(c.tree)).toHaveLength(3);
    const m = await loadConfig("/x/nginx.conf", { read: async (p) => (p === "/x/nginx.conf" ? "include gone.conf; include none/*.conf;" : null), list: async () => [] });
    expect(m.missing).toEqual([{ file: "/x/nginx.conf", line: 1, pattern: "gone.conf" }]);
  });

  it("parses listen directives", () => {
    expect(parseListen(["443", "ssl", "http2"])).toEqual({ address: null, port: 443, defaultServer: false, ssl: true });
    expect(parseListen(["127.0.0.1:8080", "default_server"])).toEqual({ address: "127.0.0.1", port: 8080, defaultServer: true, ssl: false });
    expect(parseListen(["[::]:80"])).toMatchObject({ address: "[::]", port: 80 });
    expect(parseListen(["*:81"])).toMatchObject({ address: null, port: 81 });
  });

  it("selects servers by name precedence", async () => {
    const servers = serversOf((await loadConfig("/etc/nginx/nginx.conf", loader)).tree);
    expect(selectServer(servers, "www.example.com", 80).why).toBe("exact server_name www.example.com");
    expect(selectServer(servers, "shop.example.com", 80).why).toBe("wildcard server_name *.example.com");
    expect(selectServer(servers, "other.net", 80).why).toBe("no name matched other.net; default_server for port 80");
    expect(selectServer(servers, "a.example.org", 443).why).toBe("regex server_name ~^(?P<sub>.+)\\.example\\.org$");
    expect(selectServer(servers, "x", 8443).server).toBeNull();
  });

  it("selects locations the way nginx does", async () => {
    const [s] = serversOf((await loadConfig("/etc/nginx/nginx.conf", loader)).tree);
    const pick = (u: string) => {
      const m = selectLocation(s.locations, u);
      return `${m.location?.modifier ?? ""} ${m.location?.path ?? "-"} | ${m.why}`;
    };
    expect(pick("/")).toBe("= / | exact match = /");
    expect(pick("/about")).toBe(" / | longest prefix /");
    expect(pick("/static/logo.png")).toBe("^~ /static/ | longest prefix ^~ /static/ (regexes skipped)");
    expect(pick("/photos/cat.PNG")).toBe("~* \\.(png|jpg)$ | first matching regex ~* \\.(png|jpg)$");
    expect(pick("/docs/manual.pdf")).toBe("~ \\.pdf$ | first matching regex ~ \\.pdf$, nested in /docs/");
    expect(pick("/docs/readme.png")).toBe("~* \\.(png|jpg)$ | first matching regex ~* \\.(png|jpg)$");
  });

  it("routes requests through rewrites to what is served", async () => {
    const { tree } = await loadConfig("/etc/nginx/nginx.conf", loader);
    expect(route(tree, req({ uri: "/" })).result).toEqual({ kind: "return", status: 200, body: "home" });
    expect(route(tree, req({ uri: "/about" })).result).toEqual({ kind: "file", paths: ["/var/www/site/about", "/var/www/site/about/"], fallback: "/index.html" });
    expect(route(tree, req({ uri: "/api/users", args: "page=2" })).result).toEqual({ kind: "proxy", target: "http://api_backend/v1/users?page=2", upstream: ["10.0.0.1:8080 weight=2", "10.0.0.2:8080"] });
    expect(route(tree, req({ uri: "/static/app.js" })).result).toEqual({ kind: "file", paths: ["/srv/static/app.js"], fallback: null });
    expect(route(tree, req({ uri: "/images/a.gif" })).result).toEqual({ kind: "file", paths: ["/data/img//a.gif"], fallback: null });
    const old = route(tree, req({ uri: "/old/page" }));
    expect(old.result).toEqual({ kind: "return", status: 301, body: "/new/page" });
    expect(old.steps[0]).toMatch(/^server rewrite \^\/old\/\(\.\*\)\$ → \/new\/page \(permanent\)/);
    const legacy = route(tree, req({ uri: "/legacy/guide.pdf" }));
    expect(legacy.uri).toBe("/docs/guide.pdf");
    expect(legacy.result).toEqual({ kind: "return", status: 403, body: "" });
    expect(route(tree, req({ host: "a.example.com", uri: "/x", args: "q=1" })).result).toEqual({ kind: "return", status: 301, body: "https://example.com/x?q=1" });
    expect(route(tree, req({ host: "app.example.org", port: 443, scheme: "https", uri: "/dash" })).result).toEqual({ kind: "proxy", target: "http://127.0.0.1:3000/dash", upstream: null });
  });

  it("works out which add_header lines apply", async () => {
    const { tree } = await loadConfig("/etc/nginx/nginx.conf", loader);
    expect(route(tree, req({ uri: "/about" })).headers).toEqual([{ name: "Strict-Transport-Security", value: "max-age=31536000", from: "http" }]);
    expect(route(tree, req({ uri: "/a.jpg" })).headers).toEqual([{ name: "Cache-Control", value: "max-age=86400", from: "location \\.(png|jpg)$" }]);
  });

  it("finds configuration mistakes", async () => {
    const { tree } = await loadConfig("/etc/nginx/nginx.conf", loader);
    const extra = parseNginx("http { server { listen 80 default_server; server_name example.com; autoindex on; } }", "/etc/nginx/extra.conf");
    const issues = lintNginx([...tree.filter((d) => d.name !== "http"), { ...tree.find((d) => d.name === "http")!, children: [...tree.find((d) => d.name === "http")!.children!, ...extra[0].children!] }]);
    // Sorted by file, then line: conf.d/site.conf comes before extra.conf.
    expect(issues.map((i) => `${i.file.split("/").pop()} ${i.severity}: ${i.message.slice(0, 30)}`)).toEqual([
      "site.conf warning: add_header here replaces every",
      "site.conf danger: location /images has no traili",
      "site.conf warning: ssl_protocols allows TLSv1, wh",
      "extra.conf info: autoindex on lists directory c",
      "extra.conf warning: server_name example.com on por",
      "extra.conf danger: A second default_server for po",
    ]);
  });
});

describe("nginx variable upstreams", () => {
  it("needs a resolver for proxy_pass with a variable host", () => {
    const without = parseNginx("http { server { location / { proxy_pass http://$backend:8080; } } }", "a.conf");
    expect(lintNginx(without).map((i) => i.severity)).toEqual(["danger"]);
    const withResolver = parseNginx("http { resolver 1.1.1.1; server { location / { proxy_pass http://$backend:8080; } } }", "a.conf");
    expect(lintNginx(withResolver)).toEqual([]);
  });
});
