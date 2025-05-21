import * as vscode from 'vscode'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'

let saveInterval: ReturnType<typeof setInterval> | undefined

export async function activate(context: vscode.ExtensionContext) {
	if (os.platform() !== 'linux') return vscode.window.showInformationMessage('Remember Desktops is not supported on this platform')

	const processName = path.basename(process.argv[0])
	const outputChannel = vscode.window.createOutputChannel('Remember Desktops')

	if (context.globalState.get('processWindows')) {
		setTimeout(
			() => vscode.commands.executeCommand('remember-desktops.restoreToDesktops'),
			vscode.workspace.getConfiguration('remember-desktops').get('restoreDelay') || 500
		)
	}

	outputChannel.appendLine(`Remember Desktops activated for process: ${processName}`)
	outputChannel.appendLine('- https://github.com/mathiscode/vscode-remember-desktops')

	if (vscode.workspace.getConfiguration('remember-desktops').get('intervalEnabled')) {
		vscode.commands.executeCommand('remember-desktops.saveEditorLocations')

		setTimeout(() => {
			saveInterval = setInterval(() => {
				vscode.commands.executeCommand('remember-desktops.saveEditorLocations')
			}, vscode.workspace.getConfiguration('remember-desktops').get('saveInterval'))
		}, 30_000) // give windows time to be moved before we start saving
	}

	const saveDisposable = vscode.commands.registerCommand('remember-desktops.saveEditorLocations', async () => {
		const processes = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
			exec(`ps -e -o pid,cmd`, (error, stdout, stderr) => {
				if (error) return reject(error)
				resolve({ stdout, stderr })
			})
		})

		const windows = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
			exec(`wmctrl -l -p`, (error, stdout, stderr) => {
				if (error) return reject(error)
				resolve({ stdout, stderr })
			})
		})

		const processPids = processes.stdout
			.split('\n')
			.filter(line => line.includes(processName))
			.map(line => {
				const [pid] = line.trim().split(/\s+/)
				return pid
			})

		const processWindows = windows.stdout
			.split('\n')
			.filter(line => {
				const [, , pid] = line.trim().split(/\s+/)
				return processPids.includes(pid)
			})
			.map(line => {
				const [windowId, desktop, pid, hostname, ...titleParts] = line.trim().split(/\s+/)
				return {
					windowId,
					desktop,
					pid,
					hostname,
					title: titleParts.join(' ')
				}
			})

		outputChannel.appendLine(`Saving ${processWindows.length} ${processName} windows`)
		// for (const window of processWindows) {
		// 	outputChannel.appendLine(`  PID ${window.pid} on desktop ${window.desktop}: ${window.title}`)
		// }

		if (processWindows.every(window => window.desktop === '0')) {
			outputChannel.appendLine('All windows are on desktop 0, skipping save')
			return
		}

		context.globalState.update('processWindows', processWindows)
	})

	const restoreDisposable = vscode.commands.registerCommand('remember-desktops.restoreToDesktops', () => {
		const processWindows = context.globalState.get('processWindows') as { desktop: string, title: string}[]
		if (!processWindows) return vscode.window.showInformationMessage('No process windows found')
		outputChannel.appendLine(`Restoring ${processWindows.length} windows`)

		for (const window of processWindows) {
			outputChannel.appendLine(`Moving ${window.title} to desktop ${window.desktop}`)
			exec(`wmctrl -r "${window.title}" -t ${window.desktop}`)
		}
	})

	const forgetDisposable = vscode.commands.registerCommand('remember-desktops.forgetEditorLocations', () => {
		outputChannel.appendLine('Forgetting editor locations')
		context.globalState.update('processWindows', undefined)
		vscode.window.showInformationMessage('Editor locations forgotten')
	})

	context.subscriptions.push(saveDisposable, restoreDisposable, forgetDisposable)
}

export function deactivate() {
	if (saveInterval) clearInterval(saveInterval)
}
