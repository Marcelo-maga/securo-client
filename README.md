 # Securo Native Client

 Cliente Tauri v2 para conectar uma instância self-hosted do Securo. O app valida `/api/health` antes de salvar a URL localmente.

 ## Desenvolvimento

 ```bash
 npm install
 npm run tauri -- dev
 ```

 O build desktop Linux requer `pkg-config`, GTK/WebKitGTK e as bibliotecas de desenvolvimento do sistema usadas pelo Tauri.

## Build Android

Requisitos locais:

- Node.js 22 ou superior
- Rust com os targets `aarch64-linux-android`, `armv7-linux-androideabi` e `x86_64-linux-android`
- Java 17
- Android SDK com `platform-tools`, plataforma `android-35`, build-tools `35.0.0` e NDK `27.0.12077973`

Instale as dependencias JavaScript e os targets Rust:

```bash
npm install
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```

Inicialize o projeto Android uma vez por checkout:

```bash
npm run tauri -- android init
```

Gere o APK:

```bash
npm run tauri -- android build --apk
```

Os APKs ficam em `src-tauri/gen/android/app/build/outputs/apk/`. Para instalar um APK conectado via ADB:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk
```

### Build no GitHub Actions

O workflow em `.github/workflows/release.yml` executa somente o job Android. Ele prepara o frontend, inicializa o projeto Tauri, gera o APK e publica os arquivos na release.

- Push de uma tag `v*`: cria uma release versionada.
- `workflow_dispatch`: executa manualmente e publica uma release prerelease identificada pelo numero da execucao.

O workflow usa Android API 35, build-tools `35.0.0`, NDK `27.0.12077973` e Java 17. A assinatura de release ainda nao esta configurada; os APKs publicados devem ser tratados como artefatos de CI ate que um keystore e os secrets de assinatura sejam adicionados.

 ## Arquitetura

- `src/`: tela local de configuração, sem código do frontend oficial do Securo.
- `src-tauri/src/lib.rs`: handshake HTTP, persistência via Store e comandos de reconfiguração.
- `src-tauri/capabilities/default.json`: permissões mínimas da janela principal.

 Certificados TLS autoassinados são aceitos para ambientes homelab. Use o app apenas com servidores sob seu controle.

Essa opção fica desativada por padrão e pode ser habilitada em **Configurações avançadas** na tela de conexão. Ela só é persistida depois que o handshake é concluído com sucesso.

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
