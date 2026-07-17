# 아웃리치 회계 도우미

공식 회계 Excel 템플릿과 회계교육자료의 규칙을 바탕으로 만든 Windows/macOS용 로컬 데스크톱 앱입니다. 프로젝트 데이터와 첨부파일은 사용자가 선택한 로컬 폴더에만 저장됩니다.

## 구현된 핵심 규칙

- 지출은 공식 8개 카테고리 순서로 묶고, 같은 카테고리 안에서는 날짜순으로 정렬합니다.
- 영수증 번호는 카테고리가 바뀔 때마다 1번부터 다시 부여합니다.
- 제공된 Excel의 6개 시트, 서식, 수식과 영수증철 원본 폼을 보존합니다. 행이 부족할 때는 `국내-금전출납부`에만 기존 서식을 복제해 행을 추가합니다.
- 결제자·계좌·정산 여부는 앱 내부 검산용으로만 사용하고 공식 Excel 및 영수증철에는 출력하지 않습니다.
- 오프라인 영수증은 인쇄 후 실물을 붙일 수 있는 빈 페이지를 만들고, 온라인 영수증은 첨부 이미지/PDF를 페이지에 배치합니다.
- 날짜·금액 노란색 표시와 금액 옆 영수증 번호 표시는 출력 후 사용자가 직접 합니다.
- 교통비의 주유비 계산 증빙은 지출별 짝이 아니라 교통 카테고리 공통 증빙 한 부로 관리합니다.
- CLOVA OCR API URL/Secret이 있으면 우선 사용하고, 없거나 실패하면 앱에 포함된 한국어 Tesseract OCR로 전환합니다.
- 내보내기 전에 예산, 합계, 증빙, 정산 잔액을 검사합니다.

## 로컬 개발

```bash
npm install
npm run dev
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

macOS 설치 이미지:

```bash
npm run tauri -- build --bundles dmg --no-sign
```

Windows 설치 파일은 Windows PC에서 같은 소스를 체크아웃한 뒤 다음 명령으로 빌드합니다.

```powershell
npm install
npm run tauri -- build
```

## 프로젝트 구조

```text
accounting-assistant/
├── src/                 React UI와 회계 로직
├── src-tauri/           Rust/Tauri 데스크톱 백엔드
├── public/tesseract/    완전 오프라인 OCR 실행 자산
├── resources/           앱이 복사해 사용하는 보존용 Excel 템플릿
├── reference/           사용자 제공 교육자료 원본(Git 제외)
└── artifacts/           테스트·렌더링·설치본 검증 결과(Git 제외)
```

`reference/`와 `artifacts/`는 로컬 검토용이며 GitHub에는 업로드하지 않습니다. 앱 실행과 빌드에 필요한 공식 Excel 템플릿 사본은 `resources/accounting-template.xlsx`에 포함됩니다.

## 템플릿 보존 원칙

앱은 `resources/accounting-template.xlsx`를 읽어 새 결과 파일을 생성합니다. 리소스 템플릿 자체에는 쓰지 않습니다. 원본에서 결과 파일로 복사하는 방식이므로 반복 내보내기를 해도 템플릿은 변경되지 않습니다.
