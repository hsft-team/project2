# Attendance App Mobile

Expo 기반 출퇴근 체크 앱입니다.

## 기능

- 로그인 화면
- 현재 위치 표시
- 회사 위치와 출근 가능 반경 표시
- 반경 내에서만 활성화되는 출근 버튼
- 퇴근 버튼
- 오늘 출근/퇴근 상태 표시

## 사용 패키지

- `react-native-maps`
- `expo-location`
- `axios`

## 실행

```bash
npm install
npm run start
```

이 저장소에는 로컬 Node가 이미 들어 있으므로, 현재 환경처럼 시스템 `node`가 없어도 아래 명령으로 실행할 수 있습니다.

```bash
npm run start:local
```

## 설정 포인트

- 회사 위치: `/Users/hyeonseobkim/workspace/attendance-app/mobile/src/constants/company.js`
- API 연동: `/Users/hyeonseobkim/workspace/attendance-app/mobile/src/services/api.js`

현재 기본값은 백엔드 연동 모드입니다.

- 기본 API 주소: `http://localhost:8090/api`
- iPhone 실기기 테스트 시 Mac IP가 바뀌면 `EXPO_PUBLIC_API_BASE_URL`도 같이 바꿔야 합니다.
- 데모 모드 실행: `EXPO_PUBLIC_DEMO_MODE=true npm run start:local`
- 실서버 연결: `EXPO_PUBLIC_API_BASE_URL=http://<your-mac-ip>:8090/api npm run start:local`

백엔드 기준 로그인 계정:

- 사원: `EMP001 / password1234`
- 관리자: `ADMIN001 / admin1234`

## 웹 서비스 실행

브라우저 기반 출퇴근 서비스로 사용할 수 있습니다.

### 개발 서버

```bash
npm run web:local
```

### 정적 빌드

```bash
npx expo export --platform web
```

빌드 결과물은 `dist/` 폴더에 생성됩니다.

### 운영 시 참고

- 브라우저에서 위치 권한 허용이 필요합니다.
- 백엔드 주소는 [src/services/api.js](/Users/hyeonseobkim/workspace/attendance-app/mobile/src/services/api.js) 또는 `EXPO_PUBLIC_API_BASE_URL` 로 설정합니다.
- iPhone Safari에서도 웹앱 형태로 바로 사용할 수 있습니다.
- iPhone에서 Safari로 접속 후 `공유 > 홈 화면에 추가`를 선택하면 앱처럼 실행할 수 있습니다.
