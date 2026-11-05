 # Securo Native Client

 Cliente Tauri v2 para conectar uma instância self-hosted do Securo. O app valida `/api/health` antes de salvar a URL localmente.

 ## Desenvolvimento

 ```bash
 npm install
 npm run tauri -- dev
 ```

 O build desktop Linux requer `pkg-config`, GTK/WebKitGTK e as bibliotecas de desenvolvimento do sistema usadas pelo Tauri.

 ## Arquitetura

- `src/`: tela local de configuração, sem código do frontend oficial do Securo.
- `src-tauri/src/lib.rs`: handshake HTTP, persistência via Store e comandos de reconfiguração.
- `src-tauri/capabilities/default.json`: permissões mínimas da janela principal.

 Certificados TLS autoassinados são aceitos para ambientes homelab. Use o app apenas com servidores sob seu controle.

Essa opção fica desativada por padrão e pode ser habilitada em **Configurações avançadas** na tela de conexão. Ela só é persistida depois que o handshake é concluído com sucesso.

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
