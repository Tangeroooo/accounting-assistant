# `.barun` 프로젝트 형식

`.barun`은 바른장부 프로젝트 데이터와 영수증·증빙 파일을 한 파일로 이동하기 위한 ZIP 기반 문서 패키지입니다.

## 컨테이너 구조

```text
team-accounting.barun
├── manifest.json
└── attachments/
    ├── receipt-a.png
    └── fuel-evidence.pdf
```

`manifest.json`의 최상위 필드는 다음과 같습니다.

```json
{
  "format": "barun-accounting-project",
  "formatVersion": 1,
  "savedAt": "2026-07-17T00:00:00.000Z",
  "project": {}
}
```

- `formatVersion`은 패키지 컨테이너의 호환성 버전입니다.
- `project`에는 회계 데이터와 각 첨부파일의 상대 경로, 이미지 편집값이 저장됩니다. 이미지 편집값에는 자동 흐름 배치를 위한 프레임 너비·높이, 원본 비율, 맞춤/채우기 방식과 자르기 확대율·위치·회전값이 포함됩니다.
- 기기별 절대 작업 경로와 CLOVA Secret Key는 패키지에 포함하지 않습니다.
- 첨부파일은 반드시 `attachments/` 아래에 저장합니다.
- 앱은 기존 `회계프로젝트.json`을 읽을 수 있지만 새 저장은 `.barun`을 사용합니다.
