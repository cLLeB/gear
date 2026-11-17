// Specs for the CLIs developers type most. Each covers the everyday
// subcommands and options, not every flag a tool has ever had.

import type { Arg, GeneratorId, Opt, Spec } from "./types";

const files: Arg = { template: "filepaths", variadic: true };
const file: Arg = { template: "filepaths" };
const folder: Arg = { template: "folders" };
const gen = (generator: GeneratorId, variadic = false): Arg => ({ generator, variadic });
const text = (name: string): Arg => ({ name });

function opt(names: string, description?: string, args?: Arg): Opt {
  return { name: names.split(" "), description, args };
}

function cmd(names: string, description: string, rest: Omit<Spec, "name" | "description"> = {}): Spec {
  return { name: names.split(" "), description, ...rest };
}

const help = opt("-h --help", "Show help");

// ── git ──────────────────────────────────────────────────────────────────────
const branchOrFile: Arg = { generator: "gitBranches", template: "filepaths" };
const git: Spec = cmd("git", "Version control", {
  options: [opt("-C", "Run as if started in this folder", folder), opt("--version"), opt("--no-pager", "Don't page output"), help],
  subcommands: [
    cmd("status", "Show the working tree status", { options: [opt("-s --short", "Short format"), opt("-b --branch", "Show branch info")] }),
    cmd("add", "Stage changes", { options: [opt("-A --all", "Stage everything"), opt("-p --patch", "Pick hunks"), opt("-u --update", "Stage tracked files"), opt("-N --intent-to-add")], args: [gen("gitChangedFiles", true)] }),
    cmd("commit", "Record staged changes", {
      options: [opt("-m --message", "Commit message", text("message")), opt("-a --all", "Stage tracked changes first"), opt("--amend", "Rewrite the last commit"), opt("--no-edit", "Keep the message"), opt("--no-verify", "Skip hooks"), opt("-S --gpg-sign"), opt("--fixup", "Make a fixup commit", text("commit")), opt("--allow-empty")],
    }),
    cmd("push", "Upload commits", {
      options: [opt("-u --set-upstream", "Track the remote branch"), opt("-f --force"), opt("--force-with-lease", "Force unless someone else pushed"), opt("--tags"), opt("-d --delete"), opt("--dry-run")],
      args: [gen("gitRemotes"), gen("gitLocalBranches")],
    }),
    cmd("pull", "Fetch and integrate", { options: [opt("--rebase"), opt("--ff-only"), opt("--no-rebase")], args: [gen("gitRemotes"), gen("gitBranches")] }),
    cmd("fetch", "Download from a remote", { options: [opt("--all"), opt("-p --prune"), opt("--tags")], args: [gen("gitRemotes")] }),
    cmd("checkout", "Switch branches or restore files", { options: [opt("-b", "Create a branch", text("new-branch")), opt("-B"), opt("--track")], args: [branchOrFile, files] }),
    cmd("switch", "Switch branches", { options: [opt("-c --create", "Create a branch", text("new-branch")), opt("-C --force-create", undefined, text("branch")), opt("-d --detach"), opt("-")], args: [gen("gitBranches")] }),
    cmd("restore", "Restore files", { options: [opt("-S --staged", "Unstage"), opt("-s --source", "From this commit", gen("gitBranches")), opt("-p --patch")], args: [gen("gitChangedFiles", true)] }),
    cmd("branch", "List, create or delete branches", {
      options: [opt("-a --all"), opt("-r --remotes"), opt("-d --delete", "Delete", gen("gitLocalBranches")), opt("-D", "Force delete", gen("gitLocalBranches")), opt("-m --move", "Rename", gen("gitLocalBranches")), opt("-v --verbose"), opt("--show-current"), opt("-u --set-upstream-to", undefined, gen("gitBranches"))],
      args: [gen("gitLocalBranches")],
    }),
    cmd("merge", "Join histories", { options: [opt("--no-ff"), opt("--ff-only"), opt("--squash"), opt("--abort"), opt("--continue"), opt("-m", "Message", text("message"))], args: [gen("gitBranches")] }),
    cmd("rebase", "Reapply commits on top of another base", { options: [opt("-i --interactive"), opt("--onto", undefined, gen("gitBranches")), opt("--continue"), opt("--abort"), opt("--skip"), opt("--autosquash")], args: [gen("gitBranches")] }),
    cmd("cherry-pick", "Apply commits from elsewhere", { options: [opt("-x"), opt("--continue"), opt("--abort"), opt("-n --no-commit")] }),
    cmd("revert", "Undo a commit with a new one", { options: [opt("--no-edit"), opt("--continue"), opt("--abort")] }),
    cmd("reset", "Move HEAD / unstage", { options: [opt("--soft"), opt("--mixed"), opt("--hard", "Discard changes"), opt("-p --patch")], args: [branchOrFile, files] }),
    cmd("log", "Show history", { options: [opt("--oneline"), opt("--graph"), opt("--all"), opt("-n --max-count", "How many", text("n")), opt("-p --patch"), opt("--stat"), opt("--author", undefined, text("name")), opt("--since", undefined, text("date")), opt("--grep", undefined, text("pattern")), opt("--follow")], args: [branchOrFile, files] }),
    cmd("diff", "Show changes", { options: [opt("--staged --cached", "Staged changes"), opt("--stat"), opt("--name-only"), opt("--name-status"), opt("-w --ignore-all-space"), opt("--word-diff")], args: [branchOrFile, files] }),
    cmd("show", "Show a commit", { options: [opt("--stat"), opt("--name-only")], args: [gen("gitBranches")] }),
    cmd("stash", "Shelve changes", {
      subcommands: [
        cmd("push", "Stash changes", { options: [opt("-m --message", undefined, text("message")), opt("-u --include-untracked"), opt("-k --keep-index")], args: [files] }),
        cmd("pop", "Apply and drop a stash", { args: [gen("gitStashes")] }),
        cmd("apply", "Apply a stash", { args: [gen("gitStashes")] }),
        cmd("list", "List stashes"),
        cmd("drop", "Delete a stash", { args: [gen("gitStashes")] }),
        cmd("show", "Show a stash", { options: [opt("-p --patch")], args: [gen("gitStashes")] }),
        cmd("clear", "Delete all stashes"),
      ],
      options: [opt("-u --include-untracked"), opt("-m --message", undefined, text("message"))],
    }),
    cmd("tag", "Create, list or delete tags", { options: [opt("-a --annotate"), opt("-m", undefined, text("message")), opt("-d --delete", undefined, gen("gitTags")), opt("-l --list")], args: [gen("gitTags")] }),
    cmd("remote", "Manage remotes", {
      options: [opt("-v --verbose")],
      subcommands: [cmd("add", "Add a remote"), cmd("remove rm", "Remove a remote", { args: [gen("gitRemotes")] }), cmd("rename", "Rename a remote", { args: [gen("gitRemotes")] }), cmd("set-url", "Change a remote's URL", { args: [gen("gitRemotes")] }), cmd("show", "Show a remote", { args: [gen("gitRemotes")] }), cmd("prune", "Drop stale branches", { args: [gen("gitRemotes")] })],
    }),
    cmd("clone", "Copy a repository", { options: [opt("--depth", undefined, text("n")), opt("-b --branch", undefined, text("branch")), opt("--recurse-submodules")] }),
    cmd("init", "Create a repository", { options: [opt("-b --initial-branch", undefined, text("name"))], args: [folder] }),
    cmd("worktree", "Extra working trees", {
      subcommands: [cmd("add", "Add a working tree", { options: [opt("-b", "New branch", text("branch"))], args: [folder, gen("gitBranches")] }), cmd("list", "List working trees"), cmd("remove", "Remove a working tree", { options: [opt("-f --force")], args: [folder] }), cmd("prune", "Prune stale records")],
    }),
    cmd("blame", "Who changed each line", { args: [file] }),
    cmd("bisect", "Find the commit that broke something", { subcommands: [cmd("start", "Start"), cmd("good", "Mark good"), cmd("bad", "Mark bad"), cmd("reset", "Finish"), cmd("skip", "Skip this commit")] }),
    cmd("clean", "Delete untracked files", { options: [opt("-n --dry-run"), opt("-f --force"), opt("-d", "Directories too"), opt("-x", "Ignored files too")] }),
    cmd("rm", "Remove files from git", { options: [opt("--cached", "Keep the file on disk"), opt("-r")], args: [files] }),
    cmd("mv", "Move or rename a file", { args: [file, file] }),
    cmd("submodule", "Manage submodules", { subcommands: [cmd("update", "Update", { options: [opt("--init"), opt("--recursive"), opt("--remote")] }), cmd("add", "Add"), cmd("status", "Status"), cmd("sync", "Sync URLs")] }),
    cmd("config", "Read or set options", { options: [opt("--global"), opt("--local"), opt("--list -l"), opt("--unset")] }),
  ],
});

// ── JavaScript package managers ──────────────────────────────────────────────
const pkgArgs: Arg = { name: "package", variadic: true };
function jsManager(name: string, extra: Spec[] = [], scriptsAtTop = false): Spec {
  return cmd(name, "JavaScript package manager", {
    options: [opt("-v --version"), help],
    args: scriptsAtTop ? [gen("npmScripts")] : undefined,
    subcommands: [
      cmd("run run-script", "Run a package.json script", { args: [gen("npmScripts"), { name: "args", variadic: true }] }),
      cmd("install i", "Install dependencies", { options: [opt("-D --save-dev"), opt("-g --global"), opt("--frozen-lockfile"), opt("-E --save-exact")], args: [pkgArgs] }),
      cmd("add", "Add a dependency", { options: [opt("-D --dev --save-dev"), opt("-g --global"), opt("-E --exact")], args: [pkgArgs] }),
      cmd("remove rm uninstall un", "Remove a dependency", { options: [opt("-g --global")], args: [pkgArgs] }),
      cmd("update up upgrade", "Update dependencies", { options: [opt("-L --latest"), opt("-i --interactive")], args: [pkgArgs] }),
      cmd("test t", "Run the test script"),
      cmd("start", "Run the start script"),
      cmd("exec", "Run a command from node_modules/.bin"),
      cmd("outdated", "Show outdated packages"),
      cmd("audit", "Check for vulnerable packages", { options: [opt("--fix")] }),
      cmd("publish", "Publish the package", { options: [opt("--access", undefined, { suggestions: ["public", "restricted"] }), opt("--tag", undefined, text("tag")), opt("--dry-run")] }),
      cmd("init", "Create package.json", { options: [opt("-y --yes")] }),
      cmd("why", "Why a package is installed", { args: [pkgArgs] }),
      cmd("list ls", "List installed packages", { options: [opt("--depth", undefined, text("n"))] }),
      ...extra,
    ],
  });
}
const npm = jsManager("npm", [cmd("ci", "Clean install from the lockfile"), cmd("version", "Bump the version", { args: [{ suggestions: ["patch", "minor", "major", "prerelease"] }] }), cmd("pack", "Make a tarball"), cmd("link", "Symlink a package")]);
const pnpm = jsManager("pnpm", [cmd("dlx", "Run a package without installing"), cmd("store", "Manage the store", { subcommands: [cmd("prune", "Remove unreferenced packages"), cmd("path", "Show the store path")] }), cmd("dedupe", "Deduplicate dependencies")], true);
const yarn = jsManager("yarn", [cmd("dlx", "Run a package without installing")], true);
const bun = jsManager("bun", [cmd("x", "Run a package without installing"), cmd("build", "Bundle", { args: [files] })], true);

// ── Rust ─────────────────────────────────────────────────────────────────────
const cargoCommon = [opt("-p --package", "Package", text("name")), opt("--release", "Optimised build"), opt("--features", undefined, text("features")), opt("--all-features"), opt("--no-default-features"), opt("--target", undefined, text("triple")), opt("--workspace"), opt("-q --quiet"), opt("-v --verbose")];
const cargo: Spec = cmd("cargo", "Rust package manager", {
  options: [opt("-V --version"), help, opt("--manifest-path", undefined, file)],
  subcommands: [
    cmd("build b", "Compile", { options: [...cargoCommon, opt("--bin", undefined, text("name")), opt("--examples")] }),
    cmd("run r", "Build and run", { options: [...cargoCommon, opt("--bin", undefined, text("name")), opt("--example", undefined, text("name"))] }),
    cmd("test t", "Run tests", { options: [...cargoCommon, opt("--lib"), opt("--doc"), opt("--no-run"), opt("--test", undefined, text("name"))] }),
    cmd("check c", "Check without building", { options: cargoCommon }),
    cmd("clippy", "Lint", { options: [...cargoCommon, opt("--fix"), opt("--all-targets")] }),
    cmd("fmt", "Format", { options: [opt("--check"), opt("--all")] }),
    cmd("add", "Add a dependency", { options: [opt("--dev"), opt("--build"), opt("-F --features", undefined, text("features")), opt("--optional")], args: [pkgArgs] }),
    cmd("remove rm", "Remove a dependency", { args: [pkgArgs] }),
    cmd("update", "Update the lockfile", { options: [opt("-p --package", undefined, text("name")), opt("--dry-run")] }),
    cmd("doc", "Build documentation", { options: [opt("--open"), opt("--no-deps")] }),
    cmd("bench", "Run benchmarks", { options: cargoCommon }),
    cmd("new", "Create a package", { options: [opt("--lib"), opt("--bin"), opt("--name", undefined, text("name"))], args: [folder] }),
    cmd("init", "Create a package here", { options: [opt("--lib"), opt("--bin")] }),
    cmd("install", "Install a binary", { options: [opt("--locked"), opt("--force"), opt("--git", undefined, text("url"))], args: [pkgArgs] }),
    cmd("uninstall", "Uninstall a binary", { args: [pkgArgs] }),
    cmd("tree", "Show the dependency tree", { options: [opt("-i --invert", undefined, text("package")), opt("-d --duplicates")] }),
    cmd("clean", "Remove build output", { options: [opt("--release"), opt("--doc")] }),
    cmd("publish", "Publish to the registry", { options: [opt("--dry-run"), opt("--allow-dirty")] }),
    cmd("metadata", "Print workspace metadata", { options: [opt("--format-version", undefined, { suggestions: ["1"] }), opt("--no-deps")] }),
  ],
});
const rustup: Spec = cmd("rustup", "Rust toolchain installer", {
  subcommands: [
    cmd("update", "Update toolchains"),
    cmd("show", "Show the active toolchain"),
    cmd("default", "Set the default toolchain", { args: [{ suggestions: ["stable", "beta", "nightly"] }] }),
    cmd("toolchain", "Manage toolchains", { subcommands: [cmd("install", "Install", { args: [{ suggestions: ["stable", "beta", "nightly"] }] }), cmd("list", "List"), cmd("uninstall", "Uninstall")] }),
    cmd("component", "Manage components", { subcommands: [cmd("add", "Add", { args: [{ suggestions: ["clippy", "rustfmt", "rust-analyzer", "rust-src", "llvm-tools"], variadic: true }] }), cmd("list", "List", { options: [opt("--installed")] }), cmd("remove", "Remove")] }),
    cmd("target", "Manage targets", { subcommands: [cmd("add", "Add"), cmd("list", "List", { options: [opt("--installed")] }), cmd("remove", "Remove")] }),
    cmd("override", "Per-folder toolchain", { subcommands: [cmd("set", "Set"), cmd("unset", "Unset")] }),
  ],
});

// ── containers ───────────────────────────────────────────────────────────────
const container = gen("dockerContainers");
const image = gen("dockerImages");
const compose: Spec = cmd("compose", "Multi-container apps", {
  options: [opt("-f --file", "Compose file", file), opt("-p --project-name", undefined, text("name")), opt("--profile", undefined, text("profile"))],
  subcommands: [
    cmd("up", "Create and start", { options: [opt("-d --detach"), opt("--build"), opt("--force-recreate"), opt("--remove-orphans")], args: [gen("composeServices", true)] }),
    cmd("down", "Stop and remove", { options: [opt("-v --volumes"), opt("--remove-orphans"), opt("--rmi", undefined, { suggestions: ["all", "local"] })] }),
    cmd("logs", "Show logs", { options: [opt("-f --follow"), opt("--tail", undefined, text("n")), opt("-t --timestamps")], args: [gen("composeServices", true)] }),
    cmd("ps", "List containers", { options: [opt("-a --all")] }),
    cmd("build", "Build images", { options: [opt("--no-cache"), opt("--pull")], args: [gen("composeServices", true)] }),
    cmd("restart", "Restart services", { args: [gen("composeServices", true)] }),
    cmd("stop", "Stop services", { args: [gen("composeServices", true)] }),
    cmd("start", "Start services", { args: [gen("composeServices", true)] }),
    cmd("exec", "Run in a running service", { options: [opt("-it"), opt("-e --env", undefined, text("KEY=value"))], args: [gen("composeServices")] }),
    cmd("run", "Run a one-off command", { options: [opt("--rm"), opt("-e --env", undefined, text("KEY=value"))], args: [gen("composeServices")] }),
    cmd("pull", "Pull images", { args: [gen("composeServices", true)] }),
    cmd("config", "Validate and print the config", { options: [opt("--services")] }),
  ],
});
const docker: Spec = cmd("docker", "Containers", {
  options: [opt("--context", undefined, text("name")), opt("-v --version"), help],
  subcommands: [
    cmd("ps", "List containers", { options: [opt("-a --all"), opt("-q --quiet"), opt("--format", undefined, text("template"))] }),
    cmd("run", "Run a new container", { options: [opt("-d --detach"), opt("-it"), opt("--rm"), opt("-p --publish", "host:container", text("ports")), opt("-v --volume", undefined, text("src:dst")), opt("-e --env", undefined, text("KEY=value")), opt("--name", undefined, text("name")), opt("--network", undefined, text("name")), opt("--env-file", undefined, file)], args: [image] }),
    cmd("exec", "Run in a running container", { options: [opt("-it"), opt("-e --env", undefined, text("KEY=value")), opt("-u --user", undefined, text("user")), opt("-w --workdir", undefined, text("dir"))], args: [container] }),
    cmd("logs", "Show logs", { options: [opt("-f --follow"), opt("--tail", undefined, text("n")), opt("-t --timestamps")], args: [container] }),
    cmd("stop", "Stop containers", { args: [gen("dockerContainers", true)] }),
    cmd("start", "Start containers", { args: [gen("dockerContainers", true)] }),
    cmd("restart", "Restart containers", { args: [gen("dockerContainers", true)] }),
    cmd("rm", "Remove containers", { options: [opt("-f --force"), opt("-v --volumes")], args: [gen("dockerContainers", true)] }),
    cmd("rmi", "Remove images", { options: [opt("-f --force")], args: [gen("dockerImages", true)] }),
    cmd("images", "List images", { options: [opt("-a --all"), opt("-q --quiet")] }),
    cmd("build", "Build an image", { options: [opt("-t --tag", undefined, text("name:tag")), opt("-f --file", undefined, file), opt("--no-cache"), opt("--build-arg", undefined, text("KEY=value")), opt("--platform", undefined, text("os/arch"))], args: [folder] }),
    cmd("pull", "Download an image", { args: [image] }),
    cmd("push", "Upload an image", { args: [image] }),
    cmd("inspect", "Low-level details", { args: [{ generator: "dockerContainers", variadic: true }] }),
    cmd("cp", "Copy files to or from a container", { args: [file, file] }),
    cmd("stats", "Live resource usage", { args: [gen("dockerContainers", true)] }),
    cmd("system", "Manage Docker", { subcommands: [cmd("prune", "Remove unused data", { options: [opt("-a --all"), opt("--volumes"), opt("-f --force")] }), cmd("df", "Disk usage")] }),
    cmd("volume", "Manage volumes", { subcommands: [cmd("ls", "List"), cmd("rm", "Remove"), cmd("prune", "Remove unused"), cmd("create", "Create")] }),
    cmd("network", "Manage networks", { subcommands: [cmd("ls", "List"), cmd("rm", "Remove"), cmd("create", "Create"), cmd("inspect", "Inspect")] }),
    compose,
  ],
});

// ── Kubernetes, GitHub, build tools ─────────────────────────────────────────
const kubeNs = opt("-n --namespace", "Namespace", text("namespace"));
const kubectl: Spec = cmd("kubectl", "Kubernetes", {
  options: [kubeNs, opt("--context", undefined, gen("kubeContexts")), opt("-A --all-namespaces")],
  subcommands: [
    cmd("get", "List resources", { options: [opt("-o --output", undefined, { suggestions: ["wide", "yaml", "json", "name"] }), opt("-w --watch"), opt("-l --selector", undefined, text("label=value"))], args: [gen("kubeResources"), text("name")] }),
    cmd("describe", "Show details", { args: [gen("kubeResources"), text("name")] }),
    cmd("logs", "Print pod logs", { options: [opt("-f --follow"), opt("--tail", undefined, text("n")), opt("-c --container", undefined, text("name")), opt("-p --previous")] }),
    cmd("apply", "Apply a manifest", { options: [opt("-f --filename", undefined, file), opt("-k --kustomize", undefined, folder), opt("--dry-run", undefined, { suggestions: ["client", "server"] })] }),
    cmd("delete", "Delete resources", { options: [opt("-f --filename", undefined, file)], args: [gen("kubeResources"), text("name")] }),
    cmd("exec", "Run in a container", { options: [opt("-it"), opt("-c --container", undefined, text("name"))] }),
    cmd("port-forward", "Forward local ports", { args: [text("pod"), text("ports")] }),
    cmd("rollout", "Manage rollouts", { subcommands: [cmd("status", "Status"), cmd("restart", "Restart"), cmd("undo", "Roll back"), cmd("history", "History")] }),
    cmd("scale", "Change replicas", { options: [opt("--replicas", undefined, text("n"))] }),
    cmd("config", "Kubeconfig", { subcommands: [cmd("use-context", "Switch context", { args: [gen("kubeContexts")] }), cmd("get-contexts", "List contexts"), cmd("current-context", "Show the current context"), cmd("view", "Show the config")] }),
    cmd("top", "Resource usage", { subcommands: [cmd("pod", "Pods"), cmd("node", "Nodes")] }),
  ],
});
const gh: Spec = cmd("gh", "GitHub CLI", {
  subcommands: [
    cmd("pr", "Pull requests", { subcommands: [cmd("list", "List", { options: [opt("--state", undefined, { suggestions: ["open", "closed", "merged", "all"] }), opt("--author", undefined, text("login"))] }), cmd("view", "View", { options: [opt("--web"), opt("--comments")] }), cmd("checkout co", "Check out"), cmd("create", "Create", { options: [opt("--fill"), opt("--draft"), opt("-t --title", undefined, text("title")), opt("-b --body", undefined, text("body")), opt("-B --base", undefined, gen("gitBranches")), opt("--web")] }), cmd("merge", "Merge", { options: [opt("--merge"), opt("--squash"), opt("--rebase"), opt("--delete-branch"), opt("--auto")] }), cmd("diff", "Show the diff"), cmd("checks", "Show CI checks", { options: [opt("--watch")] }), cmd("review", "Review", { options: [opt("--approve"), opt("--request-changes"), opt("--comment"), opt("-b --body", undefined, text("body"))] }), cmd("comment", "Comment", { options: [opt("-b --body", undefined, text("body"))] }), cmd("ready", "Mark ready"), cmd("close", "Close"), cmd("status", "Status of your PRs")] }),
    cmd("issue", "Issues", { subcommands: [cmd("list", "List"), cmd("view", "View", { options: [opt("--web")] }), cmd("create", "Create", { options: [opt("-t --title", undefined, text("title")), opt("-b --body", undefined, text("body")), opt("-l --label", undefined, text("label"))] }), cmd("close", "Close"), cmd("comment", "Comment")] }),
    cmd("run", "Workflow runs", { subcommands: [cmd("list", "List"), cmd("view", "View", { options: [opt("--log"), opt("--log-failed"), opt("--web")] }), cmd("watch", "Watch a run"), cmd("rerun", "Re-run", { options: [opt("--failed")] })] }),
    cmd("workflow", "Workflows", { subcommands: [cmd("list", "List"), cmd("run", "Dispatch"), cmd("view", "View")] }),
    cmd("repo", "Repositories", { subcommands: [cmd("clone", "Clone"), cmd("view", "View", { options: [opt("--web")] }), cmd("create", "Create"), cmd("fork", "Fork")] }),
    cmd("release", "Releases", { subcommands: [cmd("list", "List"), cmd("view", "View"), cmd("create", "Create"), cmd("download", "Download assets")] }),
    cmd("auth", "Authentication", { subcommands: [cmd("login", "Log in"), cmd("status", "Status"), cmd("logout", "Log out")] }),
    cmd("api", "Call the API"),
    cmd("browse", "Open in the browser"),
  ],
});
const make: Spec = cmd("make", "Run Makefile targets", { options: [opt("-j --jobs", undefined, text("n")), opt("-f --file", undefined, file), opt("-C --directory", undefined, folder), opt("-n --dry-run"), opt("-B --always-make")], args: [gen("makeTargets", true)] });
const just: Spec = cmd("just", "Run justfile recipes", { options: [opt("-l --list"), opt("-f --justfile", undefined, file), opt("--dry-run")], args: [gen("justRecipes"), { name: "args", variadic: true }] });
const pip: Spec = cmd("pip pip3", "Python packages", {
  subcommands: [cmd("install", "Install", { options: [opt("-r --requirement", undefined, file), opt("-U --upgrade"), opt("-e --editable", undefined, folder), opt("--user")], args: [pkgArgs] }), cmd("uninstall", "Uninstall", { options: [opt("-y --yes")], args: [pkgArgs] }), cmd("list", "List", { options: [opt("-o --outdated")] }), cmd("freeze", "Pinned list"), cmd("show", "Show a package", { args: [pkgArgs] })],
});
const goSpec: Spec = cmd("go", "Go toolchain", {
  subcommands: [cmd("build", "Compile", { options: [opt("-o", undefined, file), opt("-v"), opt("-race")], args: [{ name: "packages", suggestions: ["./..."], variadic: true }] }), cmd("run", "Compile and run", { args: [files] }), cmd("test", "Run tests", { options: [opt("-v"), opt("-run", undefined, text("regex")), opt("-race"), opt("-cover"), opt("-count", undefined, text("n"))], args: [{ name: "packages", suggestions: ["./..."], variadic: true }] }), cmd("mod", "Modules", { subcommands: [cmd("tidy", "Tidy go.mod"), cmd("init", "Create go.mod"), cmd("download", "Download modules"), cmd("vendor", "Vendor modules"), cmd("why", "Why a module is needed")] }), cmd("get", "Add a dependency", { options: [opt("-u")] }), cmd("install", "Install a binary"), cmd("fmt", "Format"), cmd("vet", "Report suspicious code", { args: [{ suggestions: ["./..."] }] }), cmd("generate", "Run go:generate"), cmd("env", "Print the environment"), cmd("version", "Print the version")],
});

export const SPECS: readonly Spec[] = [git, npm, pnpm, yarn, bun, cargo, rustup, docker, kubectl, gh, make, just, pip, goSpec];

const byName = new Map<string, Spec>();
for (const s of SPECS) for (const n of s.name) byName.set(n, s);
// `docker-compose` is the old standalone name of `docker compose`.
byName.set("docker-compose", { ...compose, name: ["docker-compose"] });

/** The spec for a command word, accepting a path or Windows extension (C:\x\git.exe). */
export function specFor(command: string): Spec | undefined {
  const base = command.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  return byName.get(base);
}
