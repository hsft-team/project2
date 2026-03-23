import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
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
  changePassword,
  DEMO_MODE,
  getCompanySetting,
  getPublicCompanySetting,
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

function parseNoticeMessage(message) {
  if (!message?.trim()) {
    return [];
  }

  return message
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      if (line.startsWith("## ")) {
        return {
          key: `heading-${index}`,
          type: "heading",
          text: line.slice(3).trim(),
        };
      }

      if (line.startsWith("- ")) {
        return {
          key: `bullet-${index}`,
          type: "bullet",
          text: line.slice(2).trim(),
        };
      }

      return {
        key: `paragraph-${index}`,
        type: "paragraph",
        text: line.trim(),
      };
    });
}

function normalizeNoticeColor(value) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmedValue)) {
    return trimmedValue;
  }

  if (/^[a-zA-Z]+$/.test(trimmedValue)) {
    return trimmedValue.toLowerCase();
  }

  return null;
}

function renderNoticeInline(text, textStyle, boldStyle, linkStyle) {
  const parts = [];
  const pattern =
    /\{color:([^}]+)\}(.+?)\{\/color\}|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        key: `text-${lastIndex}`,
        text: text.slice(lastIndex, match.index),
        type: "text",
      });
    }

    if (match[1] && match[2]) {
      parts.push({
        key: `color-${match.index}`,
        text: match[2],
        color: normalizeNoticeColor(match[1]),
        type: "color",
      });
    } else if (match[3] && match[4]) {
      parts.push({
        key: `link-${match.index}`,
        text: match[3],
        url: match[4],
        type: "link",
      });
    } else {
      parts.push({
        key: `bold-${match.index}`,
        text: match[5],
        type: "bold",
      });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      key: `text-tail-${lastIndex}`,
      text: text.slice(lastIndex),
      type: "text",
    });
  }

  if (parts.length === 0) {
    parts.push({
      key: "text-full",
      text,
      type: "text",
    });
  }

  return (
    <Text style={textStyle}>
      {parts.map((part) => (
        <Text
          key={part.key}
          onPress={
            part.type === "link" ? () => Linking.openURL(part.url).catch(() => {}) : undefined
          }
          style={
            part.type === "bold"
              ? boldStyle
              : part.type === "color"
                ? { color: part.color || "#172033" }
              : part.type === "link"
                ? linkStyle
                : null
          }
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function getSeoulNowInfo() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour || "0"),
  };
}

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
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCheckOutConfirm, setShowCheckOutConfirm] = useState(false);
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
    noticeMessage: "",
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

  useEffect(() => {
    let active = true;

    async function loadPublicCompanySetting() {
      const nextCompanySetting = await getPublicCompanySetting();
      if (!active || !nextCompanySetting) {
        return;
      }

      setCompanySetting((prev) => ({
        ...prev,
        ...nextCompanySetting,
      }));
      setAttendanceMeta((prev) => ({
        ...prev,
        companyName: nextCompanySetting.companyName || prev.companyName,
      }));
    }

    loadPublicCompanySetting();

    return () => {
      active = false;
    };
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

    if (auth.user?.passwordChangeRequired) {
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

    if (auth.user?.passwordChangeRequired) {
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

    if (auth.user?.passwordChangeRequired) {
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

  const seoulNow = getSeoulNowInfo();
  const effectiveAttendance = (
    seoulNow.hour >= 1 &&
    attendanceMeta.attendanceDate &&
    attendanceMeta.attendanceDate !== seoulNow.date
  ) ? INITIAL_STATUS : attendance;

  const canCheckIn =
    Boolean(auth) &&
    !effectiveAttendance.checkedInAt &&
    !submittingAttendance &&
    typeof distance === "number" &&
    typeof currentLocation?.accuracyMeters === "number" &&
    currentLocation.accuracyMeters <= MAX_LOCATION_ACCURACY_METERS &&
    distance <= companySetting.allowedRadiusMeters;

  const canCheckOut =
    Boolean(auth) &&
    !submittingAttendance;
  const noticeBlocks = useMemo(
    () => parseNoticeMessage(companySetting.noticeMessage),
    [companySetting.noticeMessage]
  );

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
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
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
        noticeMessage: "",
      });
    } catch (error) {
      showError("로그인 실패", error.message || "다시 시도해 주세요.");
    } finally {
      setLoadingLogin(false);
    }
  }

  async function handleChangePassword() {
    if (!auth?.token) {
      return;
    }

    if (!newPasswordInput || !confirmPasswordInput) {
      showError("비밀번호 변경 필요", "새 비밀번호를 모두 입력해 주세요.");
      return;
    }

    if (newPasswordInput.length < 8) {
      showError("비밀번호 변경 필요", "새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    if (newPasswordInput !== confirmPasswordInput) {
      showError("비밀번호 변경 필요", "새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    try {
      setChangingPassword(true);
      setErrorMessage("");
      const response = await changePassword({
        token: auth.token,
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      });

      const nextAuth = {
        ...auth,
        user: {
          ...auth.user,
          passwordChangeRequired: false,
        },
      };

      setAuth(nextAuth);
      saveAuth(nextAuth);
      setPassword(newPasswordInput);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      Alert.alert("비밀번호 변경 완료", response.message || "비밀번호가 변경되었습니다.");
    } catch (error) {
      showError("비밀번호 변경 실패", error.message || "잠시 후 다시 시도해 주세요.");
    } finally {
      setChangingPassword(false);
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
    if (!auth?.token) {
      return;
    }

    if (!currentLocation) {
      showError("퇴근 처리 실패", "현재 위치를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setShowCheckOutConfirm(true);
  }

  async function submitCheckOut() {
    if (!auth?.token || !currentLocation) {
      return;
    }

    try {
      setShowCheckOutConfirm(false);
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
            {attendanceMeta.companyName || companySetting.companyName || COMPANY_NAME} 출퇴근 서비스입니다. 로그인 후 브라우저에서 현재 위치를 확인하고 출근과 퇴근을 기록해 보세요. 로그인 상태는 같은 단말에서 최대 1년 유지됩니다.
          </Text>
          {errorMessage ? (
            <View style={styles.authErrorBox}>
              <Text style={styles.authErrorText}>{errorMessage}</Text>
            </View>
          ) : null}
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
            placeholder="비밀번호 (첫 로그인 직원은 비워두세요)"
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

  if (auth.user?.passwordChangeRequired) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar style="dark" />
        <View style={styles.authCard}>
          <Text style={styles.title}>비밀번호 변경</Text>
          <Text style={styles.subtitle}>
            처음 로그인한 직원은 새 비밀번호를 먼저 설정해야 합니다. 변경이 끝나면 그다음부터는 새 비밀번호로 로그인합니다.
          </Text>
          {errorMessage ? (
            <View style={styles.authErrorBox}>
              <Text style={styles.authErrorText}>{errorMessage}</Text>
            </View>
          ) : null}
          <TextInput
            onChangeText={setNewPasswordInput}
            placeholder="새 비밀번호 (8자 이상)"
            placeholderTextColor="#8c98ad"
            secureTextEntry
            style={styles.input}
            value={newPasswordInput}
          />
          <TextInput
            onChangeText={setConfirmPasswordInput}
            placeholder="새 비밀번호 확인"
            placeholderTextColor="#8c98ad"
            secureTextEntry
            style={styles.input}
            value={confirmPasswordInput}
          />
          <Pressable
            disabled={changingPassword}
            onPress={handleChangePassword}
            style={[styles.primaryButton, changingPassword && styles.buttonDisabled]}
          >
            {changingPassword ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>비밀번호 변경</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <Modal
        animationType="fade"
        transparent
        visible={showCheckOutConfirm}
        onRequestClose={() => setShowCheckOutConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>퇴근 확인</Text>
            <Text style={styles.modalDescription}>지금 퇴근 처리하시겠어요?</Text>
            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => setShowCheckOutConfirm(false)}
                style={[styles.modalButton, styles.modalSecondaryButton]}
              >
                <Text style={styles.modalSecondaryButtonText}>취소</Text>
              </Pressable>
              <Pressable
                onPress={submitCheckOut}
                style={[styles.modalButton, styles.modalPrimaryButton]}
              >
                <Text style={styles.modalPrimaryButtonText}>퇴근하기</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
        <Text style={styles.panelTitle}>공지사항</Text>
        {noticeBlocks.length > 0 ? (
          <View style={styles.noticeContent}>
            {noticeBlocks.map((block) => {
              if (block.type === "heading") {
                return (
                  <Text key={block.key} style={styles.noticeHeading}>
                    {block.text}
                  </Text>
                );
              }

              if (block.type === "bullet") {
                return (
                  <View key={block.key} style={styles.noticeBulletRow}>
                    <Text style={styles.noticeBulletMark}>•</Text>
                    <View style={styles.noticeBulletTextWrap}>
                      {renderNoticeInline(
                        block.text,
                        styles.noticeBulletText,
                        styles.noticeBoldText,
                        styles.noticeLinkText
                      )}
                    </View>
                  </View>
                );
              }

              return (
                <View key={block.key} style={styles.noticeParagraphWrap}>
                  {renderNoticeInline(
                    block.text,
                    styles.panelDescription,
                    styles.noticeBoldText,
                    styles.noticeLinkText
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.panelDescription}>등록된 공지사항이 없습니다.</Text>
        )}

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
  authErrorBox: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  authErrorText: {
    color: "#be123c",
    fontSize: 14,
    lineHeight: 20,
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
  noticeContent: {
    gap: 8,
    marginBottom: 12,
  },
  noticeHeading: {
    color: "#172033",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 2,
  },
  noticeParagraphWrap: {
    marginBottom: 2,
  },
  noticeBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  noticeBulletMark: {
    color: "#1463ff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  noticeBulletTextWrap: {
    flex: 1,
  },
  noticeBulletText: {
    color: "#59657a",
    fontSize: 15,
    lineHeight: 22,
  },
  noticeBoldText: {
    fontWeight: "800",
    color: "#172033",
  },
  noticeLinkText: {
    color: "#1463ff",
    fontWeight: "700",
    textDecorationLine: "underline",
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    gap: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#172033",
  },
  modalDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: "#5b667a",
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  modalButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryButton: {
    backgroundColor: "#1463ff",
  },
  modalSecondaryButton: {
    backgroundColor: "#eef2f8",
  },
  modalPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  modalSecondaryButtonText: {
    color: "#334155",
    fontSize: 15,
    fontWeight: "700",
  },
});
