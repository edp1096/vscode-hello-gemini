import * as vscode from 'vscode'
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai"
// import HelloGemini from './HelloGemini'

interface SnippetResponse {
	success: boolean;
	message: string;
	answer: string
}

export class App {
	public apiKey: string

	private genAI: GoogleGenerativeAI
	private model: GenerativeModel

	private editor: vscode.TextEditor | undefined
	public promptAnchor = "##$$HERE$$##"
	public promptOrder = "\nPlease complete code and closing for " + this.promptAnchor + ".\nShow only the code and except my existing prompt or any description.\n"

	constructor() {
		const apikey = vscode.workspace.getConfiguration("helloGemini").get("apikey")
		this.apiKey = typeof apikey == "string" ? apikey : ""
		this.genAI = new GoogleGenerativeAI(this.apiKey)
		this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" })
	}

	private getPosBeginEnd(currentPosition: vscode.Position, textBlock: string): { begin: vscode.Position, end: vscode.Position } {
		const textBlocks = textBlock.split("\n")
		const posBegin = currentPosition.translate(0, 0);
		const posEnd = posBegin.translate(textBlocks.length - 1, textBlocks[textBlocks.length - 1].length + 1)

		return ({ begin: posBegin, end: posEnd })
	}

	private getPrompt(currentPosition: vscode.Position, anchor: string): string {
		const editor = this.editor!

		const currentFileUri = editor.document.uri
		const fileExtension = currentFileUri ? currentFileUri.fsPath.split('.').pop() : ''

		const textBefore = editor.document.getText(new vscode.Range(new vscode.Position(0, 0), currentPosition))
		const textAfter = editor.document.getText(new vscode.Range(currentPosition, new vscode.Position(editor.document.lineCount + 1, 0)))

		const prompt = "```" + fileExtension + "\n" + textBefore + anchor + textAfter + "\n```" + this.promptOrder

		return prompt
	}

	private async getSnippet(prompt: string): Promise<SnippetResponse> {
		const r = await this.model.generateContent(prompt)
		const text = r.response.text()

		const lines = text.split('\n')
		lines.shift()
		lines.pop()

		const result = {
			success: false,
			message: "",
			answer: lines.join("\n").replace(this.promptAnchor, "")
		}

		return result
	}

	public async GenCode(context: vscode.ExtensionContext): Promise<boolean | undefined> {
		this.editor = vscode.window.activeTextEditor!
		if (!this.editor) { return }

		if (this.apiKey.trim() == "") {
			vscode.window.showInformationMessage('API key is not defined or not valid.\nAdd helloGemini.apikey: "your_api_key" to settings.json', { modal: true })
			return
		}

		const currentPosition = this.editor.selection.end  // last block position even single selection

		const prompt = this.getPrompt(currentPosition, this.promptAnchor)
		const snippet = await this.getSnippet(prompt)

		// const snippetText = "console.log('${1:Hello, World!}');\nconsole.log('hahahaha')\nconsole.log('hohooho')"  // dummy snippet
		const snippetText = snippet.answer

		if (snippetText.trim().length == 0) {
			vscode.window.showInformationMessage("Answered nothing.\nTry again.", { modal: true })
			return
		}

		const snippetDecoration = vscode.window.createTextEditorDecorationType({ color: 'gray' })

		// snippet preview
		await this.editor.insertSnippet(new vscode.SnippetString(snippetText), currentPosition)  // insert snippet code

		const snippetPosition = this.getPosBeginEnd(currentPosition, snippetText)
		const snippetStart = snippetPosition.begin
		const snippetEnd = snippetPosition.end

		const snippetRange = new vscode.Range(snippetStart, snippetEnd)
		this.editor.setDecorations(snippetDecoration, [snippetRange])  // Set inserted snippet decoration

		const disposableListener = vscode.workspace.onDidChangeTextDocument((event) => {
			const editor = this.editor!
			if (event.contentChanges.length != 1) { return }

			const pressedKey = event.contentChanges[0].text;
			const elText = editor.document.lineAt(snippetEnd.line).text

			if (elText.charCodeAt(elText.length - 1) == 32) {
				editor.edit(editBuilder => {
					editBuilder.delete(
						new vscode.Range(
							snippetEnd,
							new vscode.Position(
								snippetEnd.line,
								editor.document.lineAt(snippetEnd.line).text.length - pressedKey.length
							)
						)
					)
				})  // Remove last tab input
			} else {
				editor.edit(editBuilder => { editBuilder.delete(new vscode.Range(snippetStart, snippetEnd)) })  // Remove snippet
			}

			// Remove decoration
			editor.setDecorations(snippetDecoration, [])
			snippetDecoration.dispose()

			disposableListener.dispose() // Remove key input listener
		})

		context.subscriptions.push(disposableListener) // Wait tab or other key input
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const gencode = vscode.commands.registerCommand('hello-gemini.generate_code', () => {
		(new App()).GenCode(context)
	})
	context.subscriptions.push(gencode)
}

export function deactivate(): void { }
