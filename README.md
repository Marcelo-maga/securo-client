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

Gere um APK debug instalavel:

```bash
npm run tauri -- android build --target aarch64 --debug --apk
```

Os APKs ficam em `src-tauri/gen/android/app/build/outputs/apk/`. Para instalar um APK conectado via ADB:

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/arm64-v8a/debug/app-arm64-v8a-debug.apk
```

### Build no GitHub Actions

O repositório conta com dois fluxos de automação:
- `.github/workflows/ci.yml`: Validação automática de lint, scripts e integridade a cada push ou pull request na branch `main`.
- `.github/workflows/release.yml`: Pipeline otimizado de release para Android, publicado via tags `v*` ou disparo manual (`workflow_dispatch`).

#### Otimizações de Build e Rust
- **sccache + rust-cache**: Cache de compilação C/C++ (NDK) e crates Rust via GitHub Actions Cache backend, reduzindo o tempo de compilação em até 80% em execuções subsequentes.
- **Gradle Actions**: Cache inteligente de dependências, wrapper e build cache do Gradle via `gradle/actions/setup-gradle@v4`.
- **Profiles Cargo**: Otimização de compilação no perfil de desenvolvimento (`debug = 1` e otimização seletiva de dependências) para tempos de compilação muito mais rápidos e artefatos leves.
- **Scripts Modulares**: Extração de lógica inline em scripts Node.js padronizados em `scripts/` (`frontend:prepare`, `frontend:stage`, `android:configure`, `artifacts:package`).

#### Assinatura de Release (Keystore)
O workflow suporta geração de APK de **Release** (assinado) ou **Debug** (para testes):
- Se os seguintes secrets do repositório estiverem configurados, um APK assinado para produção é gerado e assinado via `apksigner`:
  - `ANDROID_KEYSTORE_BASE64`: Conteúdo do arquivo `.keystore`/`.jks` codificado em base64.
  - `ANDROID_KEYSTORE_PASSWORD`: Senha do keystore.
  - `ANDROID_KEY_ALIAS`: Alias da chave de assinatura.
  - `ANDROID_KEY_PASSWORD`: Senha da chave privada (se diferente do keystore).
- Caso os secrets não estejam configurados, o pipeline realiza fallback automático para um APK de debug assinado com a chave padrão do Android, garantindo que o build nunca falhe e o APK possa ser instalado imediatamente via sideload ou ADB.

#### Artefatos e Checksums
Todos os APKs gerados são renomeados semanticamente (ex: `securo-v0.1.0-arm64-v8a-debug.apk`) e acompanhados de um arquivo `SHA256SUMS.txt` com seus respectivos hashes criptográficos.

 ## Arquitetura

- `src/`: tela local de configuração, sem código do frontend oficial do Securo.
- `src-tauri/src/lib.rs`: handshake HTTP, persistência via Store e comandos de reconfiguração.
- `src-tauri/capabilities/default.json`: permissões mínimas da janela principal.

 Certificados TLS autoassinados são aceitos para ambientes homelab. Use o app apenas com servidores sob seu controle.

Essa opção fica desativada por padrão e pode ser habilitada em **Configurações avançadas** na tela de conexão. Ela só é persistida depois que o handshake é concluído com sucesso.

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
