import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  COMPANY_LOCATION,
  COMPANY_NAME,
  COMPANY_RADIUS_METERS,
} from "./src/constants/company";
import AttendanceMap from "./src/components/AttendanceMap";
import {
  checkIn,
  checkOut,
  DEMO_MODE,
  getCompanySetting,
  getTodayAttendance,
  login,
} from "./src/services/api";
import {
  clearAuth,
  getDeviceName,
  getOrCreateDeviceId,
  loadAuth,
  saveAuth,
} from "./src/utils/authStorage";
import { getDistanceInMeters } from "./src/utils/location";

const INITIAL_STATUS = {
  checkedInAt: null,
  checkedOutAt: null,
};
const MAX_LOCATION_ACCURACY_METERS = 100;

function mapPositionToLocation(position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy ?? null,
    capturedAt: new Date(position.timestamp ?? Date.now()).toISOString(),
  };
}

function formatTime(dateString) {
  if (!dateString) {
    return "-";
  }

  return new Date(dateString).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isAuthErrorMessage(message) {
  if (!message) {
    return false;
  }

  return message.includes("인증") || message.includes("로그인") || message.includes("권한");
}

export default function App() {
  const [employeeCode, setEmployeeCode] = useState("EMP001");
  const [password, setPassword] = useState("password1234");
  const [auth, setAuth] = useState(null);
  const [locationPermission, setLocationPermission] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [submittingAttendance, setSubmittingAttendance] = useState(false);
  const [attendance, setAttendance] = useState(INITIAL_STATUS);
  const [attendanceMeta, setAttendanceMeta] = useState({
    attendanceDate: null,
    companyName: COMPANY_NAME,
    status: null,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [companySetting, setCompanySetting] = useState({
    companyName: COMPANY_NAME,
    latitude: COMPANY_LOCATION.latitude,
    longitude: COMPANY_LOCATION.longitude,
    allowedRadiusMeters: COMPANY_RADIUS_METERS,
  });

  useEffect(() => {
    const savedAuth = loadAuth();
    if (savedAuth?.token) {
      setAuth(savedAuth);
      setAttendanceMeta({
        attendanceDate: null,
        companyName: savedAuth.user?.companyName || COMPANY_NAME,
        status: null,
      });
    }
  }, []);
  const isWeb = Platform.OS === "web";
  const isSecureWebContext =
    !isWeb ||
    window.isSecureContext ||
    window.location.hostname === "localhost";
  const webLocationHelpText = !isSecureWebContext
    ? "위치 권한은 HTTPS에서만 동작합니다. https://m.hsft.io.kr 로 접속한 뒤 다시 시도해 주세요."
    : "Safari 주소창의 aA > 웹 사이트 설정 > 위치 > 허용으로 바꾸면 회사 반경 안에서 출근 버튼이 활성화됩니다.";

  function showError(title, message) {
    const nextMessage = message || "알 수 없는 오류가 발생했습니다.";
    setErrorMessage(nextMessage);
    Alert.alert(title, nextMessage);
  }

  async function requestAndWatchLocation(onLocationChange) {
    setLoadingLocation(true);

    const { status } = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(status);

    if (status !== "granted") {
      setLoadingLocation(false);
      return undefined;
    }

    const initialPosition = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    onLocationChange(initialPosition);

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
        timeInterval: 5000,
      },
      onLocationChange
    );

    setLoadingLocation(false);
    return subscription;
  }

  async function handleRetryLocationPermission() {
    if (!auth) {
      return;
    }

    try {
      setErrorMessage("");
      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setCurrentLocation(mapPositionToLocation(currentPosition));
      setLocationPermission("granted");
    } catch (error) {
      showError("위치 권한 필요", error.message || webLocationHelpText);
    }
  }

  useEffect(() => {
    if (!auth?.token) {
      return undefined;
    }

    let active = true;

    async function loadTodayAttendance() {
      try {
        const todayAttendance = await getTodayAttendance({ token: auth.token });
        if (active) {
          setAttendance({
            checkedInAt: todayAttendance.checkedInAt,
            checkedOutAt: todayAttendance.checkedOutAt,
          });
          setAttendanceMeta({
            attendanceDate: todayAttendance.attendanceDate,
            companyName: todayAttendance.companyName || auth.user.companyName || COMPANY_NAME,
            status: todayAttendance.status,
          });
        }
      } catch (error) {
        if (active) {
          if (isAuthErrorMessage(error.message)) {
            clearAuth();
            setAuth(null);
            return;
          }
          showError("상태 조회 실패", error.message || "오늘 출근 상태를 불러오지 못했습니다.");
        }
      }
    }

    loadTodayAttendance();

    return () => {
      active = false;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (!auth?.token) {
      return undefined;
    }

    let active = true;

    async function loadCompanySetting() {
      try {
        const nextCompanySetting = await getCompanySetting({ token: auth.token });
        if (active && nextCompanySetting) {
          setCompanySetting(nextCompanySetting);
          setAttendanceMeta((prev) => ({
            ...prev,
            companyName: nextCompanySetting.companyName || prev.companyName,
          }));
        }
      } catch (error) {
        if (active) {
          if (isAuthErrorMessage(error.message)) {
            clearAuth();
            setAuth(null);
            return;
          }
          showError("회사 설정 조회 실패", error.message || "회사 설정을 불러오지 못했습니다.");
        }
      }
    }

    loadCompanySetting();

    return () => {
      active = false;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (!auth) {
      return undefined;
    }

    let mounted = true;
    let subscription;

    function updateLocation(position) {
      if (!mounted) {
        return;
      }

      setCurrentLocation({
        ...mapPositionToLocation(position),
      });
    }

    async function watchLocation() {
      const nextSubscription = await requestAndWatchLocation(updateLocation);
      if (!mounted) {
        nextSubscription?.remove();
        return;
      }

      subscription = nextSubscription;
    }

    watchLocation().catch(() => {
      if (mounted) {
        setLoadingLocation(false);
        showError("위치 확인 실패", "현재 위치를 가져오지 못했습니다.");
      }
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [auth]);

  const distance = useMemo(() => {
    if (!currentLocation) {
      return null;
    }

    return getDistanceInMeters(currentLocation, {
      latitude: companySetting.latitude,
      longitude: companySetting.longitude,
    });
  }, [companySetting.latitude, companySetting.longitude, currentLocation]);

  const canCheckIn =
    Boolean(auth) &&
    !attendance.checkedInAt &&
    !submittingAttendance &&
    typeof distance === "number" &&
    typeof currentLocation?.accuracyMeters === "number" &&
    currentLocation.accuracyMeters <= MAX_LOCATION_ACCURACY_METERS &&
    distance <= companySetting.allowedRadiusMeters;

  const canCheckOut =
    Boolean(auth) &&
    Boolean(currentLocation) &&
    attendance.checkedInAt &&
    !attendance.checkedOutAt &&
    !submittingAttendance &&
    typeof distance === "number" &&
    typeof currentLocation?.accuracyMeters === "number" &&
    currentLocation.accuracyMeters <= MAX_LOCATION_ACCURACY_METERS &&
    distance <= companySetting.allowedRadiusMeters;

  async function handleLogin() {
    try {
      setLoadingLogin(true);
      setErrorMessage("");
      const response = await login({
        employeeCode,
        password,
        deviceId: getOrCreateDeviceId(),
        deviceName: getDeviceName(),
      });
      setAuth(response);
      saveAuth(response);
      setAttendance(INITIAL_STATUS);
      setAttendanceMeta({
        attendanceDate: null,
        companyName: response.user.companyName || COMPANY_NAME,
        status: null,
      });
      setCompanySetting({
        companyName: response.user.companyName || COMPANY_NAME,
        latitude: COMPANY_LOCATION.latitude,
        longitude: COMPANY_LOCATION.longitude,
        allowedRadiusMeters: COMPANY_RADIUS_METERS,
      });
    } catch (error) {
      showError("로그인 실패", error.message || "다시 시도해 주세요.");
    } finally {
      setLoadingLogin(false);
    }
  }

  async function handleCheckIn() {
    if (!currentLocation || !auth?.token) {
      return;
    }

    try {
      setSubmittingAttendance(true);
      setErrorMessage("");
      const response = await checkIn({
        token: auth.token,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracyMeters: currentLocation.accuracyMeters,
        capturedAt: currentLocation.capturedAt,
      });

      setAttendance((prev) => ({
        ...prev,
        checkedInAt: response.checkedInAt || new Date().toISOString(),
      }));
      Alert.alert("출근 완료", response.message || "정상적으로 출근 처리되었습니다.");
    } catch (error) {
      showError("출근 처리 실패", error.message || "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmittingAttendance(false);
    }
  }

  async function handleCheckOut() {
    if (!auth?.token || !currentLocation) {
      return;
    }

    try {
      setSubmittingAttendance(true);
      setErrorMessage("");
      const response = await checkOut({
        token: auth.token,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracyMeters: currentLocation.accuracyMeters,
        capturedAt: currentLocation.capturedAt,
      });
      setAttendance((prev) => ({
        ...prev,
        checkedOutAt: response.checkedOutAt || new Date().toISOString(),
      }));
      setAttendanceMeta((prev) => ({
        ...prev,
        status: response.status || "CHECKED_OUT",
      }));
      Alert.alert("퇴근 완료", response.message || "정상적으로 퇴근 처리되었습니다.");
    } catch (error) {
      showError("퇴근 처리 실패", error.message || "잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmittingAttendance(false);
    }
  }

  if (!auth) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar style="dark" />
        <View style={styles.authCard}>
          <Text style={styles.title}>출퇴근 체크</Text>
          <Text style={styles.subtitle}>
            {COMPANY_NAME} 출퇴근 서비스입니다. 로그인 후 브라우저에서 현재 위치를 확인하고 출근과 퇴근을 기록해 보세요. 로그인 상태는 같은 단말에서 최대 1년 유지됩니다.
          </Text>
          <TextInput
            autoCapitalize="none"
            onChangeText={setEmployeeCode}
            placeholder="사번"
            placeholderTextColor="#8c98ad"
            style={styles.input}
            value={employeeCode}
          />
          <TextInput
            onChangeText={setPassword}
            placeholder="비밀번호"
            placeholderTextColor="#8c98ad"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable
            disabled={loadingLogin}
            onPress={handleLogin}
            style={[styles.primaryButton, loadingLogin && styles.buttonDisabled]}
          >
            {loadingLogin ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>로그인</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      ) : null}
      <View style={styles.header}>
        <View>
          <Text style={styles.welcomeText}>{auth.user.name}님</Text>
          <Text style={styles.statusText}>
            {auth.user.employeeCode} · 오늘 출근 {formatTime(attendance.checkedInAt)} / 퇴근 {formatTime(attendance.checkedOutAt)}
          </Text>
          <Text style={styles.companyText}>
            {attendanceMeta.companyName || COMPANY_NAME} 반경 {companySetting.allowedRadiusMeters}m
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {DEMO_MODE
              ? distance == null
                ? "DEMO"
                : `DEMO ${Math.round(distance)}m`
              : distance == null
                ? "위치 확인 중"
                : `${Math.round(distance)}m`}
          </Text>
        </View>
      </View>

      <View style={styles.mapCard}>
        {loadingLocation ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#1463ff" />
            <Text style={styles.helperText}>현재 위치를 확인하고 있습니다.</Text>
          </View>
        ) : locationPermission !== "granted" ? (
          <View style={styles.centerState}>
            <Text style={styles.helperTitle}>위치 권한이 필요합니다.</Text>
            <Text style={styles.helperText}>
              {Platform.OS === "web"
                ? webLocationHelpText
                : "권한을 허용하면 회사 반경 안에서만 출근 버튼이 활성화됩니다."}
            </Text>
            <Pressable
              onPress={handleRetryLocationPermission}
              style={styles.permissionButton}
            >
              <Text style={styles.permissionButtonText}>위치 권한 다시 요청</Text>
            </Pressable>
            {Platform.OS === "web" ? (
              <Text style={styles.permissionHint}>
                iPhone Safari에서는 주소창 왼쪽의 aA 메뉴에서 위치 권한을 다시 허용할 수 있습니다.
              </Text>
            ) : null}
          </View>
        ) : (
          <AttendanceMap
            companyLocation={{
              latitude: companySetting.latitude,
              longitude: companySetting.longitude,
              latitudeDelta: COMPANY_LOCATION.latitudeDelta,
              longitudeDelta: COMPANY_LOCATION.longitudeDelta,
            }}
            companyName={attendanceMeta.companyName || COMPANY_NAME}
            companyRadiusMeters={companySetting.allowedRadiusMeters}
            currentLocation={currentLocation}
            style={styles.map}
          />
        )}
      </View>

      <View style={styles.bottomPanel}>
        <Text style={styles.panelTitle}>오늘 상태</Text>
        <Text style={styles.panelDescription}>
          {attendance.checkedOutAt
            ? "오늘 퇴근까지 완료되었습니다."
            : attendance.checkedInAt
              ? "출근 완료. 회사 반경 안에서 정확한 위치가 확인되면 퇴근 버튼이 활성화됩니다."
              : "회사 반경 안에서 정확한 위치가 확인되면 출근 버튼이 활성화됩니다."}
        </Text>
        <Text style={styles.helperRow}>
          기준 위치: {attendanceMeta.companyName || COMPANY_NAME}
        </Text>
        {DEMO_MODE ? (
          <Text style={styles.demoText}>
            데모 모드가 활성화되어 있어 백엔드 없이 로그인과 출퇴근 테스트가 가능합니다.
          </Text>
        ) : null}
        {Platform.OS === "web" ? (
          <Text style={styles.helperRow}>
            웹 서비스 모드: iPhone Safari 또는 데스크톱 브라우저에서 바로 사용할 수 있습니다.
          </Text>
        ) : null}
        {attendanceMeta.status ? (
          <Text style={styles.helperRow}>상태: {attendanceMeta.status}</Text>
        ) : null}
        {attendanceMeta.attendanceDate ? (
          <Text style={styles.helperRow}>근무일: {attendanceMeta.attendanceDate}</Text>
        ) : null}
        {typeof currentLocation?.accuracyMeters === "number" ? (
          <Text style={styles.helperRow}>위치 정확도: 약 {Math.round(currentLocation.accuracyMeters)}m</Text>
        ) : null}
        {auth?.expiresAt ? (
          <Text style={styles.helperRow}>로그인 유지 만료: {new Date(auth.expiresAt).toLocaleDateString("ko-KR")}</Text>
        ) : null}
        <Text style={styles.helperRow}>
            오늘 출근 {formatTime(attendance.checkedInAt)} / 퇴근 {formatTime(attendance.checkedOutAt)}
          </Text>

        <Pressable
          disabled={!canCheckIn}
          onPress={handleCheckIn}
          style={[styles.checkInButton, !canCheckIn && styles.buttonDisabled]}
        >
          {submittingAttendance && !attendance.checkedInAt ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.checkInButtonText}>출근하기</Text>
          )}
        </Pressable>

        <Pressable
          disabled={!canCheckOut}
          onPress={handleCheckOut}
          style={[styles.secondaryButton, !canCheckOut && styles.buttonDisabled]}
        >
          {submittingAttendance && attendance.checkedInAt && !attendance.checkedOutAt ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.secondaryButtonText}>퇴근하기</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: {
    flex: 1,
    backgroundColor: "#f3f6fb",
    justifyContent: "center",
    padding: 24,
  },
  authCard: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: {
    color: "#172033",
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 8,
  },
  subtitle: {
    color: "#5a657a",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#eef3fb",
    borderRadius: 16,
    color: "#172033",
    fontSize: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  container: {
    flex: 1,
    backgroundColor: "#eef3fb",
  },
  errorBanner: {
    backgroundColor: "#ffe3e3",
    borderBottomColor: "#ffc9c9",
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  errorBannerText: {
    color: "#c92a2a",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  welcomeText: {
    color: "#172033",
    fontSize: 24,
    fontWeight: "800",
  },
  statusText: {
    color: "#536076",
    fontSize: 14,
    marginTop: 4,
  },
  companyText: {
    color: "#6a7487",
    fontSize: 13,
    marginTop: 4,
  },
  badge: {
    backgroundColor: "#dbe8ff",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  badgeText: {
    color: "#1447b8",
    fontSize: 14,
    fontWeight: "700",
  },
  mapCard: {
    flex: 1,
    marginHorizontal: 16,
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: "#dfe7f4",
  },
  map: {
    flex: 1,
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  helperTitle: {
    color: "#172033",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 8,
  },
  helperText: {
    color: "#5c677b",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    textAlign: "center",
  },
  permissionButton: {
    alignItems: "center",
    backgroundColor: "#1463ff",
    borderRadius: 16,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  permissionHint: {
    color: "#7b8598",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 12,
    textAlign: "center",
  },
  bottomPanel: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  panelTitle: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  panelDescription: {
    color: "#59657a",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
  },
  helperRow: {
    color: "#7b8598",
    fontSize: 13,
    marginBottom: 4,
  },
  demoText: {
    color: "#1447b8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1463ff",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 56,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  checkInButton: {
    alignItems: "center",
    backgroundColor: "#1463ff",
    borderRadius: 22,
    justifyContent: "center",
    minHeight: 68,
    marginBottom: 12,
  },
  checkInButtonText: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#172033",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 54,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
