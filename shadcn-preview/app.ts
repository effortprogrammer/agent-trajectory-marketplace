import {
	INSTALL_COMMAND,
	PROCESS_STEPS,
	type ProcessStepId,
} from "./content.js";

type DialogMode = "buyer" | "signin";
type CopyState = "error" | "idle" | "success";

const required = <ElementType extends Element>(
	selector: string,
): ElementType => {
	const element = document.querySelector<ElementType>(selector);
	if (element === null) throw new Error(`Missing preview element: ${selector}`);
	return element;
};

const menuButton = required<HTMLButtonElement>(".menu-button");
const mobileNavigation = required<HTMLElement>("#mobile-navigation");
const dialog = required<HTMLDialogElement>(".access-dialog");
const dialogTitle = required<HTMLElement>(".dialog-title");
const dialogDescription = required<HTMLElement>(".dialog-description");
const dialogForm = required<HTMLFormElement>(".dialog-form");
const emailInput = required<HTMLInputElement>("#access-email");
const consentRow = required<HTMLElement>(".checkbox-row");
const consentInput = required<HTMLInputElement>(".checkbox-row input");
const dialogSubmit = required<HTMLButtonElement>(".dialog-submit");
const dialogSuccess = required<HTMLElement>(".dialog-success");
const dialogSuccessTitle = required<HTMLElement>(".dialog-success strong");
const dialogSwitch = required<HTMLButtonElement>(".dialog-switch");
const dialogClose = required<HTMLButtonElement>(".dialog-close");
const processIndex = required<HTMLElement>(".record-index");
const processTitle = required<HTMLElement>(".process-record h3");
const processBody = required<HTMLElement>(".process-body");
const processCommand = required<HTMLElement>(".process-command code");
const copyButton = required<HTMLButtonElement>(".command-card button");
const installCode = required<HTMLElement>(".command-card code");
const copyStatus = required<HTMLElement>(".copy-status");
const processTabs = Array.from(
	document.querySelectorAll<HTMLButtonElement>(".process-tab"),
);
const faqItems = Array.from(
	document.querySelectorAll<HTMLDetailsElement>(".accordion-item"),
);

let dialogMode: DialogMode = "buyer";
let dialogReturnTarget: HTMLElement | null = null;

const setMenuOpen = (open: boolean): void => {
	mobileNavigation.hidden = !open;
	menuButton.setAttribute("aria-expanded", String(open));
	menuButton.setAttribute(
		"aria-label",
		open ? "Close navigation" : "Open navigation",
	);
};

const selectStep = (id: ProcessStepId, focus = false): void => {
	const step = PROCESS_STEPS.find((candidate) => candidate.id === id);
	if (step === undefined) return;
	for (const tab of processTabs) {
		const selected = tab.dataset.step === id;
		tab.classList.toggle("active", selected);
		tab.setAttribute("aria-selected", String(selected));
		tab.tabIndex = selected ? 0 : -1;
		if (selected && focus) tab.focus();
	}
	processIndex.textContent = `Step ${step.number}`;
	processTitle.textContent = step.title;
	processBody.textContent = step.body;
	processCommand.textContent = step.command;
};

const resetDialog = (): void => {
	dialogForm.reset();
	dialogForm.hidden = false;
	dialogSuccess.hidden = true;
};

const renderDialog = (mode: DialogMode): void => {
	dialogMode = mode;
	resetDialog();
	const buyer = mode === "buyer";
	dialogTitle.textContent = buyer ? "Request buyer access" : "Sign in to ATM";
	dialogDescription.textContent = buyer
		? "Enter your work email and confirm ATM may contact you about this access request."
		: "Existing members receive a one-time verification code. No password required.";
	consentRow.hidden = !buyer;
	consentInput.required = buyer;
	dialogSubmit.textContent = buyer
		? "Request access ->"
		: "Send one-time code ->";
	dialogSwitch.textContent = buyer
		? "Already a member? Sign in"
		: "Need dataset access? Request it";
};

const openDialog = (mode: DialogMode, trigger: HTMLElement): void => {
	dialogReturnTarget = trigger;
	renderDialog(mode);
	dialog.showModal();
	queueMicrotask(() => emailInput.focus());
};

const setCopyState = (state: CopyState): void => {
	copyStatus.dataset.copyState = state;
	const messages: Readonly<Record<CopyState, string>> = {
		error: "Clipboard access failed. Select and copy the command.",
		idle: "Install the seller CLI",
		success: "Install command copied.",
	};
	copyStatus.textContent = messages[state];
};

const copyInstallCommand = async (): Promise<void> => {
	if (navigator.clipboard === undefined) {
		setCopyState("error");
		return;
	}
	try {
		await navigator.clipboard.writeText(INSTALL_COMMAND);
		setCopyState("success");
	} catch (error) {
		if (error instanceof DOMException) {
			setCopyState("error");
			return;
		}
		throw error;
	}
};

menuButton.addEventListener("click", () =>
	setMenuOpen(mobileNavigation.hidden),
);
for (const link of Array.from(mobileNavigation.querySelectorAll("a"))) {
	link.addEventListener("click", () => setMenuOpen(false));
}
document.addEventListener("keydown", (event) => {
	if (event.key !== "Escape" || mobileNavigation.hidden || dialog.open) return;
	setMenuOpen(false);
	queueMicrotask(() => menuButton.focus());
});
for (const trigger of Array.from(
	document.querySelectorAll<HTMLButtonElement>("[data-dialog-mode]"),
)) {
	trigger.addEventListener("click", () => {
		const mode = trigger.dataset.dialogMode;
		if (mode === "buyer" || mode === "signin") openDialog(mode, trigger);
	});
}
dialogClose.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
	if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
	resetDialog();
	queueMicrotask(() => dialogReturnTarget?.focus());
});
dialogSwitch.addEventListener("click", () => {
	renderDialog(dialogMode === "buyer" ? "signin" : "buyer");
	emailInput.focus();
});
dialogForm.addEventListener("submit", (event) => {
	event.preventDefault();
	dialogForm.hidden = true;
	dialogSuccess.hidden = false;
	dialogSuccessTitle.textContent =
		dialogMode === "buyer"
			? "Buyer access flow previewed."
			: "Sign-in flow previewed.";
	dialogSuccess.focus();
});
for (const tab of processTabs) {
	tab.addEventListener("click", () => {
		const id = tab.dataset.step;
		if (id === "collect" || id === "redact" || id === "publish") selectStep(id);
	});
}
required<HTMLElement>(".process-tabs").addEventListener("keydown", (event) => {
	if (!(event instanceof KeyboardEvent)) return;
	const current = processTabs.findIndex(
		(tab) => tab.getAttribute("aria-selected") === "true",
	);
	let offset: -1 | 1;
	switch (event.key) {
		case "ArrowLeft":
			offset = -1;
			break;
		case "ArrowRight":
			offset = 1;
			break;
		default:
			return;
	}
	event.preventDefault();
	const next =
		processTabs[(current + offset + processTabs.length) % processTabs.length];
	const id = next?.dataset.step;
	if (id === "collect" || id === "redact" || id === "publish")
		selectStep(id, true);
});
for (const item of faqItems) {
	item.addEventListener("toggle", () => {
		if (!item.open) return;
		for (const candidate of faqItems)
			if (candidate !== item) candidate.open = false;
	});
}
copyButton.addEventListener("click", () => void copyInstallCommand());
installCode.textContent = INSTALL_COMMAND;
selectStep("collect");
