'use strict';

import * as path from "path";
import * as vscode from 'vscode';
import * as http from "http";
import * as ws from "ws";
import * as latex_workshop from './extension';
import {compile} from './compile';

var fs = require('fs');

export function preview(file_uri, column) {
    if (!file_uri)
        file_uri = vscode.window.activeTextEditor.document.uri;

    if (!column)
        switch (vscode.window.activeTextEditor.viewColumn) {
            case vscode.ViewColumn.One: return preview(file_uri, vscode.ViewColumn.Two);
            case vscode.ViewColumn.Two: return preview(file_uri, vscode.ViewColumn.Three);
            default: return preview(file_uri, vscode.ViewColumn.One);
        }

    if (!fs.existsSync(texUri2pdfFile(file_uri))) {
        compile();
    }

    var uri = file_uri.with({scheme:'latex-workshop-preview'});
    var title = "Preview";

    vscode.commands.executeCommand("vscode.previewHtml", uri, column, title);
}

export function source(preview_uri) {
    var uri = preview_uri.with({scheme: "file"});
    for (var editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === uri.toString()) {
            return vscode.window.showTextDocument(editor.document, editor.viewColumn);
        }
    }
    return vscode.workspace.openTextDocument(uri).then(vscode.window.showTextDocument);
}

function texUri2pdfFile(uri: vscode.Uri): string {
    return path.join(path.dirname(uri.fsPath), path.basename(uri.fsPath, '.tex') + '.pdf');
}

export class previewProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private resource_path;
    private http_server;
    private ws_server;
    private listening;
    private clients = new Map<string, ws>();
    private exec = require('child_process').exec;

    constructor(private context) {
        this.resource_path = file => this.context.asAbsolutePath(file);
        this.http_server = http.createServer();
        this.ws_server = ws.createServer({server: this.http_server});
        this.listening = new Promise((c, e) => this.http_server.listen(0, "localhost", undefined, err => err ? e(err) : c()));
        this.ws_server.on("connection", client => {
            client.on("message", this.onClientMessage.bind(this, client));
            client.on("close", this.onClientClose.bind(this, client));
        });
    }

    dispose() {}

    private async onClientMessage(client, msg) {
        var data = JSON.parse(msg);

        switch (data.type) {
            case "open":
                this.clients.set(data.path, client);
                break;
            case "click":
                var cmd = `synctex edit -o "${data.page}:${data.pos[0]}:${data.pos[1]}:${decodeURIComponent(data.path)}"`;
                
                let promise = require('child-process-promise').exec(cmd);
                var log;
                await promise
                .then((child) => {
                    log = child.stdout;
                })
                .catch((err) => {
                    latex_workshop.workshop_output.clear();
                    latex_workshop.workshop_output.append(String(err));
                    latex_workshop.workshop_output.show();
                    vscode.window.showErrorMessage(`Synctex returned error code ${err.code}. See LaTeX Workshop log for details.`);
                })
                console.log(log);
                break;
            default:
                break;
        }
    }
    private onClientClose(client) {}

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update(uri: vscode.Uri) {
        if (!uri)
            uri = vscode.window.activeTextEditor.document.uri;
        uri = uri.with({scheme:'latex-workshop-preview'})
        this._onDidChange.fire(uri);
    }

    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        var file = texUri2pdfFile(uri);
        var {address, port} = this.http_server.address();
        var websocket_addr = `ws://${address}:${port}`;
        return `
<!DOCTYPE html><html><head></head>
<body>
<iframe class="preview-panel" src="${this.resource_path('pdfjs/web/viewer.html')}?file=${encodeURIComponent(file)}&server=${websocket_addr}&path=${file}" style="position:absolute; border: none; left: 0; top: 0; width: 100%; height: 100%;"></iframe>
</body>
</html>`;
    }
}