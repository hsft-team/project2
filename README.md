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

- 기본 API 주소: `http://192.168.123.159:8080/api`
- iPhone 실기기 테스트 시 Mac IP가 바뀌면 `EXPO_PUBLIC_API_BASE_URL`도 같이 바꿔야 합니다.
- 데모 모드 실행: `EXPO_PUBLIC_DEMO_MODE=true npm run start:local`
- 실서버 연결: `EXPO_PUBLIC_API_BASE_URL=http://<your-mac-ip>:8080/api npm run start:local`

백엔드 기준 로그인 계정:

- 사원: `EMP001 / password1234`
- 관리자: `ADMIN001 / admin1234`

## iPhone 설치

이 프로젝트는 `EAS Build` 기준으로 두 가지 설치 경로를 준비해 두었습니다.

### 1. Internal Distribution

테스트용으로 iPhone에 직접 설치하는 빌드입니다.

```bash
npx eas login
npx eas build:configure
npx eas build -p ios --profile preview
```

- 설치 전에 Apple Developer 계정 로그인이 필요합니다.
- 최초 1회 `npx eas login` 과 `npx eas build:configure` 를 실행하면 EAS 프로젝트 연결과 자격 증명 설정이 진행됩니다.
- 연결이 완료되면 Expo가 실제 `projectId`를 자동으로 넣을 수 있습니다.

### 2. TestFlight

배포형 iOS 빌드를 만들고 TestFlight로 올리는 경로입니다.

```bash
npx eas build -p ios --profile production
npx eas submit -p ios --profile production
```

- TestFlight 제출 전 [eas.json](/Users/hyeonseobkim/workspace/attendance-app/mobile/eas.json)의 `submit.production.ios.ascAppId`를 실제 App Store Connect 앱 ID로 바꿔야 합니다.
- [app.json](/Users/hyeonseobkim/workspace/attendance-app/mobile/app.json)의 기본 번들 ID는 `com.attendance.mobile` 입니다. 실제 배포 전 팀 소유 번들 ID로 바꾸는 것을 권장합니다.
