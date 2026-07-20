# 데스크톱 릴리스와 자동 업데이트

GitHub Actions는 태그가 푸시되면 다음 설치본을 빌드해 하나의 공개 GitHub Release에 첨부합니다.

- macOS Apple Silicon: DMG
- macOS Intel: DMG
- Windows x64: NSIS setup EXE
- 자동 업데이트용 서명 파일과 `latest.json`

모든 운영체제 빌드가 완료되어 Release가 공개되면 이미 설치된 앱이 `latest.json`을 통해 새 버전을 확인할 수 있습니다.

## 최초 한 번: 업데이트 서명키 등록

업데이트 서명 개인키는 소스 저장소 밖의 다음 위치에 생성되어 있습니다.

```text
~/.tauri/accounting-assistant-updater.key
```

이 키를 잃으면 기존 설치본에 더 이상 업데이트를 배포할 수 없습니다. 비공개 백업 저장소에 별도로 보관하고 Git에 커밋하지 마세요.

GitHub CLI에 `Tangeroooo` 계정으로 로그인한 뒤 개인키 내용을 Repository Actions secret으로 등록합니다.

```bash
gh auth login -h github.com
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/accounting-assistant-updater.key
```

로컬에서 서명된 macOS 업데이트 번들까지 만들 때는 개인키 파일 경로를 다음처럼 전달합니다.

```bash
TAURI_SIGNING_PRIVATE_KEY=~/.tauri/accounting-assistant-updater.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD='' npm run tauri -- build --bundles app,dmg
```

Repository의 `Settings → Actions → General → Workflow permissions`는 `Read and write permissions`로 설정합니다.

## 새 버전 배포

예를 들어 `0.2.0`을 배포하려면 다음 순서로 진행합니다.

```bash
npm run version:set -- 0.2.0
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
git add package.json package-lock.json scripts/set-version.mjs src-tauri docs .github
git commit -m "release: prepare v0.2.0"
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

GitHub Actions가 끝나면 GitHub의 Releases 화면에 `바른장부 v0.2.0`이 공개됩니다. 각 설치본과 `/releases/latest/download/latest.json`을 확인하고, 문제가 있으면 Release를 숨기는 대신 수정 버전의 패치 릴리스(예: `0.2.1`)를 배포합니다.

## 다운로드 홈페이지

`main` 브랜치의 `website/` 또는 Pages 워크플로가 변경되면 다음 주소로 한국어 다운로드 홈페이지를 배포합니다.

```text
https://tangeroooo.github.io/accounting-assistant/
```

홈페이지는 GitHub의 최신 공개 Release API를 읽어 Apple Silicon DMG, Intel DMG, Windows EXE 버튼을 실제 설치 파일에 자동 연결합니다. 첫 배포 전 Repository의 `Settings → Pages → Build and deployment → Source`를 `GitHub Actions`로 설정해야 합니다.

## 앱에서 보이는 흐름

앱은 시작 약 2.5초 뒤 조용히 새 버전을 확인합니다. 새 버전이 있을 때만 안내창을 표시합니다. 상단의 새로고침 모양 버튼으로 언제든 직접 확인할 수도 있습니다.

사용자가 `저장 후 업데이트`를 누르면 현재 `.barun` 프로젝트를 원자적으로 저장하고, 같은 폴더에 `프로젝트명-업데이트전-백업.barun` 복구 사본을 만든 다음에만 업데이트를 내려받아 서명을 검증하고 설치합니다. 프로젝트를 아직 한 번도 저장하지 않았다면 먼저 저장 위치 선택 창을 표시하며, 저장이나 백업이 실패하거나 취소되면 업데이트도 시작하지 않습니다. 설치가 끝나면 앱을 다시 시작합니다.

## 운영체제 코드 서명

업데이트 서명은 이미 설정되어 있지만 운영체제 게시자 서명은 별개입니다.

- 현재 macOS 빌드는 ad-hoc 서명을 사용합니다. 외부 공개 배포 전에는 Apple Developer ID 인증서와 notarization secret을 GitHub Actions에 연결하는 것이 좋습니다.
- 현재 Windows 빌드는 게시자 인증서로 서명하지 않습니다. 외부 공개 배포 전에는 코드 서명 인증서를 연결하는 것이 좋습니다.

운영체제 인증서가 없어도 내부 시험 설치는 가능하지만 macOS Gatekeeper 또는 Windows SmartScreen 경고가 표시될 수 있습니다.
