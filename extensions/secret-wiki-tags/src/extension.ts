import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { getTagCompletions } from "./completions";
import { analyzeTagDiagnostics, type TagDiagnostic } from "./diagnostics";
import { isInTagsValueContext, type TextRange } from "./frontmatter";
import { defaultConfigFile, loadTagConfig, parseTagConfig, type TagConfig } from "./tagConfig";

const diagnosticSource = "Secret Wiki Tags";

let diagnostics: vscode.DiagnosticCollection;
let currentConfig: TagConfig | undefined;
let currentConfigProblems: readonly string[] = [];
let workspaceRoot: string | undefined;
let configWatcher: vscode.FileSystemWatcher | undefined;
let vaultWatcher: vscode.FileSystemWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  diagnostics = vscode.languages.createDiagnosticCollection("secret-wiki-tags");
  context.subscriptions.push(diagnostics);

  workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage("Secret Wiki Tags requires an open workspace.");
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("secretWikiTags.reloadTagConfig", async () => {
      await reloadTagConfig(true);
    }),
    vscode.commands.registerCommand("secretWikiTags.addTag", async (tag: string) => {
      await addTagToConfig(tag);
      await reloadTagConfig(true);
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown", scheme: "file" },
      {
        provideCompletionItems(document, position) {
          if (!currentConfig || !isTargetMarkdown(document)) {
            return [];
          }

          if (!isInTagsValueContext(document.getText(), { line: position.line, character: position.character })) {
            return [];
          }

          return getTagCompletions(currentConfig).map((entry) => {
            const item = new vscode.CompletionItem(entry.label, vscode.CompletionItemKind.Value);
            item.detail = entry.detail;
            item.insertText = entry.label;
            return item;
          });
        }
      },
      "-",
      "[",
      ",",
      "\"",
      "'"
    ),
    vscode.languages.registerCodeActionsProvider(
      { language: "markdown", scheme: "file" },
      new SecretWikiTagCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidOpenTextDocument((document) => updateDiagnostics(document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("secretWikiTags")) {
        resetWatchers(context);
        await reloadTagConfig(false);
      }
    })
  );

  resetWatchers(context);
  await reloadTagConfig(false);
}

export function deactivate(): void {
  diagnostics?.clear();
  configWatcher?.dispose();
  vaultWatcher?.dispose();
}

class SecretWikiTagCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    if (!currentConfig || !isTargetMarkdown(document)) {
      return [];
    }

    const tagDiagnostics = analyzeTagDiagnostics(document.getText(), currentConfig);
    const actions: vscode.CodeAction[] = [];

    for (const tagDiagnostic of tagDiagnostics) {
      const diagnosticRange = toVsCodeRange(tagDiagnostic.range);
      if (!rangeTouchesDiagnostic(range, diagnosticRange)) {
        continue;
      }

      if (!hasMatchingDiagnostic(context.diagnostics, tagDiagnostic)) {
        continue;
      }

      if (tagDiagnostic.kind === "alias" && tagDiagnostic.canonical) {
        const action = new vscode.CodeAction(`Replace with "${tagDiagnostic.canonical}"`, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnosticRange, tagDiagnostic.canonical);
        action.isPreferred = true;
        actions.push(action);
      }

      if (tagDiagnostic.kind === "unknown") {
        const action = new vscode.CodeAction(`Add "${tagDiagnostic.tag}" to wiki-tags.json`, vscode.CodeActionKind.QuickFix);
        action.command = {
          command: "secretWikiTags.addTag",
          title: `Add "${tagDiagnostic.tag}" to wiki-tags.json`,
          arguments: [tagDiagnostic.tag]
        };
        actions.push(action);
      }
    }

    return actions;
  }
}

async function reloadTagConfig(showMessage: boolean): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const configFile = getConfigFile();
  const result = await loadTagConfig(workspaceRoot, configFile);
  currentConfig = result.config;
  currentConfigProblems = result.problems.map((problem) => problem.message);

  if (currentConfigProblems.length > 0) {
    vscode.window.showErrorMessage(`Secret Wiki tag config has errors: ${currentConfigProblems.join(" ")}`);
  } else if (showMessage) {
    vscode.window.showInformationMessage(`Secret Wiki Tags loaded ${currentConfig?.tags.length ?? 0} tags.`);
  }

  updateAllDiagnostics();
}

function updateAllDiagnostics(): void {
  for (const document of vscode.workspace.textDocuments) {
    updateDiagnostics(document);
  }
}

function updateDiagnostics(document: vscode.TextDocument): void {
  if (!isTargetMarkdown(document)) {
    diagnostics.delete(document.uri);
    return;
  }

  if (!currentConfig) {
    diagnostics.set(document.uri, []);
    return;
  }

  const tagDiagnostics = analyzeTagDiagnostics(document.getText(), currentConfig);
  diagnostics.set(document.uri, tagDiagnostics.map(toVsCodeDiagnostic));
}

function toVsCodeDiagnostic(tagDiagnostic: TagDiagnostic): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(
    toVsCodeRange(tagDiagnostic.range),
    tagDiagnostic.message,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = diagnosticSource;
  diagnostic.code = tagDiagnostic.kind;
  return diagnostic;
}

function toVsCodeRange(range: TextRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}

function hasMatchingDiagnostic(vscodeDiagnostics: readonly vscode.Diagnostic[], tagDiagnostic: TagDiagnostic): boolean {
  return vscodeDiagnostics.some((diagnostic) => {
    return (
      diagnostic.source === diagnosticSource &&
      diagnostic.code === tagDiagnostic.kind &&
      diagnostic.message === tagDiagnostic.message
    );
  });
}

function rangeTouchesDiagnostic(range: vscode.Range, diagnosticRange: vscode.Range): boolean {
  return diagnosticRange.contains(range.start) || diagnosticRange.contains(range.end) || Boolean(diagnosticRange.intersection(range));
}

function isTargetMarkdown(document: vscode.TextDocument): boolean {
  if (document.languageId !== "markdown" || document.uri.scheme !== "file") {
    return false;
  }

  const relative = normalizePath(vscode.workspace.asRelativePath(document.uri, false));
  const vaultGlob = vscode.workspace.getConfiguration("secretWikiTags").get<string>("vaultGlob") ?? "vault/**/*.md";
  if (vaultGlob === "vault/**/*.md") {
    return relative.startsWith("vault/") && relative.endsWith(".md");
  }

  const prefix = normalizePath(vaultGlob.split("**")[0] ?? "").replace(/\/$/, "");
  return relative.endsWith(".md") && (prefix ? relative.startsWith(`${prefix}/`) || relative === prefix : true);
}

function resetWatchers(context: vscode.ExtensionContext): void {
  configWatcher?.dispose();
  vaultWatcher?.dispose();

  if (!workspaceRoot) {
    return;
  }

  configWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceRoot, getConfigFile())
  );
  configWatcher.onDidChange(() => reloadTagConfig(false), undefined, context.subscriptions);
  configWatcher.onDidCreate(() => reloadTagConfig(false), undefined, context.subscriptions);
  configWatcher.onDidDelete(() => reloadTagConfig(false), undefined, context.subscriptions);
  context.subscriptions.push(configWatcher);

  const vaultGlob = vscode.workspace.getConfiguration("secretWikiTags").get<string>("vaultGlob") ?? "vault/**/*.md";
  vaultWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, vaultGlob));
  vaultWatcher.onDidChange((uri) => updateDocumentByUri(uri), undefined, context.subscriptions);
  vaultWatcher.onDidCreate((uri) => updateDocumentByUri(uri), undefined, context.subscriptions);
  vaultWatcher.onDidDelete((uri) => diagnostics.delete(uri), undefined, context.subscriptions);
  context.subscriptions.push(vaultWatcher);
}

function updateDocumentByUri(uri: vscode.Uri): void {
  const document = vscode.workspace.textDocuments.find((entry) => entry.uri.toString() === uri.toString());
  if (document) {
    updateDiagnostics(document);
  }
}

async function addTagToConfig(tag: string): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const configPath = path.resolve(workspaceRoot, getConfigFile());
  const raw = await fs.readFile(configPath, "utf8");
  const result = parseTagConfig(raw, configPath);
  if (!result.config) {
    vscode.window.showErrorMessage(`Cannot add tag until wiki-tags.json is valid: ${result.problems.map((problem) => problem.message).join(" ")}`);
    return;
  }

  if (result.config.tagSet.has(tag)) {
    return;
  }

  const next = {
    tags: [...result.config.tags, tag].sort((left, right) => left.localeCompare(right, "ja")),
    aliases: Object.fromEntries(result.config.aliases)
  };
  await fs.writeFile(configPath, `${JSON.stringify(next, undefined, 2)}\n`, "utf8");
}

function getConfigFile(): string {
  return vscode.workspace.getConfiguration("secretWikiTags").get<string>("configFile") ?? defaultConfigFile;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
