import {
	AiContentGenerator02Icon,
	CommandLineIcon,
	Folder01Icon,
	GitBranchIcon,
	TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { homeDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AiInputBar, AiInputBarConnect } from "@/modules/ai";
import { Chip } from "@/modules/ai/components/Chip";
import { useComposer } from "@/modules/ai/lib/composer";
import { focusLeafInput } from "@/modules/terminal";
import ShellInput from "@/modules/terminal/block/ShellInput";
import { useBlockController } from "@/modules/terminal/lib/blockController";
import { useTheme } from "@/modules/theme";
import { OsIcon } from "./OsIcon";
import { useGitBranch } from "./useGitBranch";
import { useSystemInfo } from "./useSystemInfo";

// Ctrl+U (⌘U) dispatches this so the terminal.toggleInput shortcut can flip the
// bar between Shell and AI from anywhere.
export const WORKSPACE_INPUT_TOGGLE_EVENT = "gear:toggle-block-input";

let cachedHome: string | null = null;
void homeDir()
	.then((h) => {
		cachedHome = h.replace(/\/+$/, "");
	})
	.catch(() => {});

type Props = {
	/** Active leaf of the current block tab. */
	leafId: number;
	/** Reactive working directory of the active block tab (OSC 7). */
	cwd: string | null;
	/** An AI model is configured — enables the AI half of the bar. */
	hasComposer: boolean;
	/** Open the model settings so the user can connect a provider. */
	onConnect: () => void;
};

// Unified Shell / AI command bar for block terminals. The shell half is the
// block ShellInput; the AI half is our full-featured AiInputBar (slash
// commands, snippets, agent switcher, file picker) — nothing is given up. A
// Ctrl+U toggle and a row of environment chips sit around them.
export function WorkspaceInputBar({
	leafId,
	cwd,
	hasComposer,
	onConnect,
}: Props) {
	const c = useComposer();
	const { resolvedMode, themeId, customThemes } = useTheme();
	const themeKey = `${resolvedMode}:${themeId}:${customThemes.length}`;
	const { os, shell } = useSystemInfo();

	const controller = useBlockController(leafId);
	const blockMode = controller?.blockMode ?? "prompt";

	// Re-resolve the branch chip when a command finishes (covers `git checkout`).
	const [promptNonce, setPromptNonce] = useState(0);
	const prevBlockMode = useRef(blockMode);
	useEffect(() => {
		if (prevBlockMode.current !== "prompt" && blockMode === "prompt") {
			setPromptNonce((n) => n + 1);
		}
		prevBlockMode.current = blockMode;
	}, [blockMode]);
	const branch = useGitBranch(cwd, promptNonce);

	const [mode, setMode] = useState<"shell" | "ai">("shell");
	const effectiveMode = hasComposer ? mode : "shell";
	const showToggle = hasComposer;

	const switchMode = (next: "shell" | "ai") => {
		setMode(next);
		requestAnimationFrame(() => {
			if (next === "ai") c.textareaRef.current?.focus();
			else focusLeafInput(leafId);
		});
	};

	const modeRef = useRef(mode);
	modeRef.current = mode;
	const switchModeRef = useRef(switchMode);
	switchModeRef.current = switchMode;
	useEffect(() => {
		if (!showToggle) return;
		const onToggle = () =>
			switchModeRef.current(modeRef.current === "shell" ? "ai" : "shell");
		window.addEventListener(WORKSPACE_INPUT_TOGGLE_EVENT, onToggle);
		return () =>
			window.removeEventListener(WORKSPACE_INPUT_TOGGLE_EVENT, onToggle);
	}, [showToggle]);

	if (!controller) return null;

	return (
		<div
			data-ai-input-bar
			className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2"
		>
			<div className="flex flex-col gap-2 rounded-lg px-1 py-1">
				<div className="flex flex-wrap items-center gap-1.5">
					{os && (
						<Chip tone="neutral" iconNode={<OsIcon os={os} />} title={os} />
					)}
					{cwd && (
						<Chip tone="blue" icon={Folder01Icon} title={cwd}>
							{relPath(cwd)}
						</Chip>
					)}
					{branch && (
						<Chip
							tone="violet"
							icon={GitBranchIcon}
							title={`Branch: ${branch}`}
						>
							{branch}
						</Chip>
					)}
					{shell && (
						<Chip tone="emerald" icon={CommandLineIcon}>
							{shell}
						</Chip>
					)}
				</div>

				<div className="flex items-end gap-2.5">
					<div className="relative min-w-0 flex-1">
						<div className={cn(effectiveMode !== "shell" && "hidden")}>
							<ShellInput
								leafId={leafId}
								mode={blockMode}
								focused={effectiveMode === "shell"}
								themeKey={themeKey}
								onSubmit={controller.submitCommand}
								onInterrupt={controller.interrupt}
								getCwd={controller.getCwd}
							/>
						</div>
						{hasComposer && (
							<div className={cn(effectiveMode !== "ai" && "hidden")}>
								<AiInputBar />
							</div>
						)}
						{!hasComposer && effectiveMode === "ai" && (
							<AiInputBarConnect onAdd={onConnect} />
						)}
					</div>
					{showToggle && (
						<div className="shrink-0 pb-px">
							<ModeToggle mode={mode} onChange={switchMode} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function ModeToggle({
	mode,
	onChange,
}: {
	mode: "shell" | "ai";
	onChange: (next: "shell" | "ai") => void;
}) {
	return (
		<div className="relative grid shrink-0 grid-cols-2 rounded-md p-0.5 text-[10.5px] ring-1 ring-inset ring-border/35">
			<span
				aria-hidden
				className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[4px] bg-accent/60 transition-transform duration-200 ease-out"
				style={{
					transform: mode === "ai" ? "translateX(100%)" : "translateX(0)",
				}}
			/>
			<SegButton
				active={mode === "shell"}
				icon={TerminalIcon}
				label="Shell"
				onClick={() => onChange("shell")}
			/>
			<SegButton
				active={mode === "ai"}
				icon={AiContentGenerator02Icon}
				label="AI"
				onClick={() => onChange("ai")}
			/>
		</div>
	);
}

function SegButton({
	active,
	icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: typeof AiContentGenerator02Icon;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"relative z-10 flex items-center justify-center gap-1 rounded-[4px] px-2 py-[2.5px] font-medium transition-colors",
				active
					? "text-foreground/90"
					: "text-muted-foreground/70 hover:text-foreground",
			)}
		>
			<HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
			{label}
		</button>
	);
}

function relPath(p: string): string {
	if (!cachedHome) return p;
	if (p === cachedHome || p.startsWith(`${cachedHome}/`)) {
		return `~${p.slice(cachedHome.length)}`;
	}
	return p;
}
