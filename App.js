import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
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
  previewInvite,
} from "./src/services/api";
import {
  clearEmployeeCode,
  clearAuth,
  getDeviceName,
  getOrCreateDeviceId,
  loadEmployeeCode,
  loadAuth,
  saveEmployeeCode,
  saveAuth,
} from "./src/utils/authStorage";
import {
  convertFilesToCelebrationPhotos,
  loadCelebrationSettings,
  MAX_CELEBRATION_PHOTOS,
  pickRandomCelebrationPhoto,
  saveCelebrationSettings,
} from "./src/utils/celebrationPhotoStorage";
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

function extractTokenFromSegment(rawSegment) {
  if (!rawSegment) {
    return null;
  }

  const normalizedSegment = rawSegment.startsWith("#")
    ? rawSegment.slice(1)
    : rawSegment;
  const queryIndex = normalizedSegment.indexOf("?");
  const queryString = queryIndex >= 0
    ? normalizedSegment.slice(queryIndex + 1)
    : normalizedSegment;

  if (!queryString) {
    return null;
  }

  try {
    const params = new URLSearchParams(queryString);
    return params.get("token");
  } catch (error) {
    const match = queryString.match(/(?:^|[?&])token=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function extractInviteTokenFromUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const queryToken = parsedUrl.searchParams.get("token");
    if (queryToken) {
      return queryToken;
    }

    const hashToken = extractTokenFromSegment(parsedUrl.hash);
    if (hashToken) {
      return hashToken;
    }

    const decodedHashToken = extractTokenFromSegment(decodeURIComponent(parsedUrl.hash || ""));
    if (decodedHashToken) {
      return decodedHashToken;
    }
  } catch (error) {
    const match = rawUrl.match(/(?:[?&]|#.*[?&])token=([^&#]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  return extractTokenFromSegment(rawUrl);
}

function buildInviteAppUrl(token) {
  if (!token) {
    return "attendanceapp://invite";
  }

  return `attendanceapp://invite?token=${encodeURIComponent(token)}`;
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

function getDisplayLocationName(attendanceMeta, companySetting) {
  return (
    attendanceMeta.workplaceName ||
    companySetting.workplaceName ||
    attendanceMeta.companyName ||
    companySetting.companyName ||
    COMPANY_NAME
  );
}

function getSkinPalette(skinKey) {
  switch ((skinKey || "classic").toLowerCase()) {
    case "ocean":
      return {
        screen: "#e8f6f4",
        screenAlt: "#f3fbfa",
        surface: "#ffffff",
        surfaceSoft: "#ecf8f6",
        text: "#123235",
        muted: "#5f7a7c",
        primary: "#0f9d94",
        primaryDark: "#0a6f69",
        accent: "#d5f3ee",
        accentText: "#0b6a63",
        border: "#cfeae5",
        mapCard: "#d6efe9",
      };
    case "sunset":
      return {
        screen: "#fff1e8",
        screenAlt: "#fff7f2",
        surface: "#ffffff",
        surfaceSoft: "#fff2ea",
        text: "#3b1f17",
        muted: "#856256",
        primary: "#ef6c4d",
        primaryDark: "#b84730",
        accent: "#ffe0d2",
        accentText: "#b84730",
        border: "#f4d3c4",
        mapCard: "#f7dfd2",
      };
    case "classic":
    default:
      return {
        screen: "#eef3fb",
        screenAlt: "#f3f6fb",
        surface: "#ffffff",
        surfaceSoft: "#f4f7fb",
        text: "#172033",
        muted: "#5a657a",
        primary: "#1463ff",
        primaryDark: "#172033",
        accent: "#dbe8ff",
        accentText: "#1447b8",
        border: "#dbe4f0",
        mapCard: "#dfe7f4",
      };
  }
}

function createThemeStyles(palette) {
  return StyleSheet.create({
    authContainer: { backgroundColor: palette.screenAlt },
    authCard: { backgroundColor: palette.surface },
    title: { color: palette.text },
    subtitle: { color: palette.muted },
    input: { backgroundColor: palette.surfaceSoft, color: palette.text },
    checkboxChecked: { backgroundColor: palette.primary, borderColor: palette.primary },
    container: { backgroundColor: palette.screen },
    headerText: { color: palette.text },
    welcomeCode: { color: palette.muted },
    badge: { backgroundColor: palette.accent },
    badgeText: { color: palette.accentText },
    mapCard: { backgroundColor: palette.mapCard },
    helperTitle: { color: palette.text },
    helperText: { color: palette.muted },
    permissionButton: { backgroundColor: palette.primary },
    bottomPanel: { backgroundColor: palette.surface },
    attendanceSummaryCard: { backgroundColor: palette.surfaceSoft, borderColor: palette.border },
    attendanceSummaryLabel: { color: palette.muted },
    attendanceSummaryValue: { color: palette.text },
    panelTitle: { color: palette.text },
    panelDescription: { color: palette.muted },
    noticeHeading: { color: palette.text },
    noticeBulletMark: { color: palette.primary },
    noticeBulletText: { color: palette.muted },
    noticeBoldText: { color: palette.text },
    noticeLinkText: { color: palette.primary },
    primaryButton: { backgroundColor: palette.primary },
    backButton: { borderColor: palette.border },
    backButtonText: { color: palette.muted },
    checkInButton: { backgroundColor: palette.primary },
    secondaryButton: { backgroundColor: palette.primaryDark },
    modalPrimaryButton: { backgroundColor: palette.primary },
    modalSecondaryButton: { backgroundColor: palette.surfaceSoft },
    modalTitle: { color: palette.text },
    modalDescription: { color: palette.muted },
  });
}

export default function App() {
  const passwordInputRef = useRef(null);
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [rememberEmployeeCode, setRememberEmployeeCode] = useState(false);
  const [auth, setAuth] = useState(null);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCheckOutConfirm, setShowCheckOutConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showImageSettings, setShowImageSettings] = useState(false);
  const [locationPermission, setLocationPermission] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [submittingAttendance, setSubmittingAttendance] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [invitePreview, setInvitePreview] = useState(null);
  const [attendance, setAttendance] = useState(INITIAL_STATUS);
  const [attendanceMeta, setAttendanceMeta] = useState({
    attendanceDate: null,
    companyName: COMPANY_NAME,
    workplaceName: null,
    status: null,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [companySetting, setCompanySetting] = useState({
    companyName: COMPANY_NAME,
    workplaceName: null,
    latitude: COMPANY_LOCATION.latitude,
    longitude: COMPANY_LOCATION.longitude,
    allowedRadiusMeters: COMPANY_RADIUS_METERS,
    noticeMessage: "",
    mobileSkinKey: "classic",
  });
  const [celebrationEnabled, setCelebrationEnabled] = useState(false);
  const [celebrationPhotos, setCelebrationPhotos] = useState([]);
  const [uploadingCelebrationPhotos, setUploadingCelebrationPhotos] = useState(false);
  const [activeCelebrationPhoto, setActiveCelebrationPhoto] = useState(null);
  const [showCelebrationPhoto, setShowCelebrationPhoto] = useState(false);
  const [isNoticeExpanded, setIsNoticeExpanded] = useState(false);

  useEffect(() => {
    const savedEmployeeCode = loadEmployeeCode();
    if (savedEmployeeCode) {
      setEmployeeCode(savedEmployeeCode);
      setRememberEmployeeCode(true);
    }

    const savedAuth = loadAuth();
    if (savedAuth?.token) {
      setAuth(savedAuth);
      setAttendanceMeta({
        attendanceDate: null,
        companyName: savedAuth.user?.companyName || COMPANY_NAME,
        workplaceName: savedAuth.user?.workplaceName || null,
        status: null,
      });
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    const savedSettings = loadCelebrationSettings();
    setCelebrationEnabled(savedSettings.enabled);
    setCelebrationPhotos(savedSettings.photos);
    if (savedSettings.enabled && savedSettings.activePhotoId) {
      const savedActivePhoto = savedSettings.photos.find((photo) => photo.id === savedSettings.activePhotoId);
      if (savedActivePhoto) {
        setActiveCelebrationPhoto(savedActivePhoto);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeInviteLink() {
      const initialUrl =
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.href
          : await Linking.getInitialURL();
      if (!active) {
        return;
      }

      const token = extractInviteTokenFromUrl(initialUrl);
      if (token) {
        setInviteToken(token);
      }
    }

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const token = extractInviteTokenFromUrl(url);
      if (token) {
        setInviteToken(token);
      }
    });

    initializeInviteLink();

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!inviteToken) {
      return;
    }

    setPassword("");

    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.activeElement?.blur?.();
      passwordInputRef.current?.blur?.();
    }
  }, [inviteToken]);

  useEffect(() => {
    let active = true;

    async function loadInvitePreview() {
      if (!inviteToken) {
        setInvitePreview(null);
        return;
      }

      try {
        setLoadingInvite(true);
        setErrorMessage("");
        const preview = await previewInvite({ inviteToken });
        if (!active) {
          return;
        }
        setInvitePreview(preview);
        setEmployeeCode(preview.employeeCode || "");
        setPassword("");
        setRememberEmployeeCode(true);
        saveEmployeeCode(preview.employeeCode || "");
      } catch (error) {
        if (!active) {
          return;
        }
        setInvitePreview(null);
        setErrorMessage(error.message || "초대 정보를 확인하지 못했습니다.");
      } finally {
        if (active) {
          setLoadingInvite(false);
        }
      }
    }

    loadInvitePreview();

    return () => {
      active = false;
    };
  }, [inviteToken]);

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
        workplaceName: nextCompanySetting.workplaceName || null,
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
    : "Safari 주소창의 aA > 웹 사이트 설정 > 위치 > 허용으로 바꾸면 사업장 반경 안에서 출근 버튼이 활성화됩니다.";

  function showError(title, message) {
    const nextMessage = message || "알 수 없는 오류가 발생했습니다.";
    setErrorMessage(nextMessage);
    Alert.alert(title, nextMessage);
  }

  function confirmAction(title, message, onConfirm) {
    if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.confirm === "function") {
      if (window.confirm(`${title}\n\n${message}`)) {
        onConfirm();
      }
      return;
    }

    Alert.alert(title, message, [
      { text: "취소", style: "cancel" },
      {
        text: "확인",
        style: "destructive",
        onPress: onConfirm,
      },
    ]);
  }

  function persistCelebrationSettings(nextSettings) {
    saveCelebrationSettings(nextSettings);
    setCelebrationEnabled(nextSettings.enabled);
    setCelebrationPhotos(nextSettings.photos);
  }

  function showRandomCelebrationPhoto(photoCandidates = celebrationPhotos) {
    if (!celebrationEnabled) {
      return;
    }

    const nextPhoto = pickRandomCelebrationPhoto(photoCandidates);
    if (!nextPhoto) {
      return;
    }

    persistCelebrationSettings({
      enabled: celebrationEnabled,
      photos: photoCandidates,
      activePhotoId: nextPhoto.id,
    });
    setActiveCelebrationPhoto(nextPhoto);
    setShowCelebrationPhoto(true);
  }

  async function handleOpenImagePicker() {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      Alert.alert("이미지 설정", "현재는 웹모바일에서 이미지 업로드를 지원합니다.");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;

    input.onchange = async (event) => {
      const files = Array.from(event.target?.files || []);
      if (!files.length) {
        return;
      }

      try {
        setUploadingCelebrationPhotos(true);
        const nextPhotos = await convertFilesToCelebrationPhotos(files);
        const mergedPhotos = [...celebrationPhotos, ...nextPhotos].slice(-MAX_CELEBRATION_PHOTOS);
        persistCelebrationSettings({
          enabled: celebrationEnabled,
          photos: mergedPhotos,
          activePhotoId: activeCelebrationPhoto?.id || null,
        });
      } catch (error) {
        showError("이미지 업로드 실패", error.message || "이미지를 불러오지 못했습니다.");
      } finally {
        setUploadingCelebrationPhotos(false);
      }
    };

    input.click();
  }

  function handleToggleCelebrationEnabled(nextValue) {
    persistCelebrationSettings({
      enabled: nextValue,
      photos: celebrationPhotos,
      activePhotoId: nextValue ? activeCelebrationPhoto?.id || null : null,
    });
  }

  function handleClearCelebrationPhotos() {
    confirmAction("이미지 모두 삭제", "등록한 이미지를 모두 지울까요?", () => {
      persistCelebrationSettings({
        enabled: false,
        photos: [],
        activePhotoId: null,
      });
      setActiveCelebrationPhoto(null);
      setShowCelebrationPhoto(false);
    });
  }

  function handleRemoveCelebrationPhoto(photoId) {
    const targetPhoto = celebrationPhotos.find((photo) => photo.id === photoId);
    if (!targetPhoto) {
      return;
    }

    confirmAction("이미지 삭제", "이 이미지를 삭제할까요?", () => {
      const remainingPhotos = celebrationPhotos.filter((photo) => photo.id !== photoId);
      const nextActivePhotoId =
        activeCelebrationPhoto?.id === photoId ? null : activeCelebrationPhoto?.id || null;
      persistCelebrationSettings({
        enabled: remainingPhotos.length ? celebrationEnabled : false,
        photos: remainingPhotos,
        activePhotoId: nextActivePhotoId,
      });

      if (activeCelebrationPhoto?.id === photoId) {
        setActiveCelebrationPhoto(null);
        setShowCelebrationPhoto(false);
      }
    });
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
            workplaceName: todayAttendance.workplaceName || auth.user.workplaceName || null,
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
            workplaceName: nextCompanySetting.workplaceName || null,
          }));
        }
      } catch (error) {
        if (active) {
          if (isAuthErrorMessage(error.message)) {
            clearAuth();
            setAuth(null);
            return;
          }
          showError("사업장 설정 조회 실패", error.message || "사업장 설정을 불러오지 못했습니다.");
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

  useEffect(() => {
    if (!effectiveAttendance.checkedInAt || !celebrationEnabled || !activeCelebrationPhoto) {
      setShowCelebrationPhoto(false);
      return;
    }

    setShowCelebrationPhoto(true);
  }, [activeCelebrationPhoto, celebrationEnabled, effectiveAttendance.checkedInAt]);

  useEffect(() => {
    if (!effectiveAttendance.checkedInAt || !celebrationEnabled || !celebrationPhotos.length) {
      return;
    }

    const activePhotoStillExists = activeCelebrationPhoto
      ? celebrationPhotos.some((photo) => photo.id === activeCelebrationPhoto.id)
      : false;

    if (activePhotoStillExists) {
      return;
    }

    const fallbackPhoto = pickRandomCelebrationPhoto(celebrationPhotos);
    if (!fallbackPhoto) {
      return;
    }

    persistCelebrationSettings({
      enabled: celebrationEnabled,
      photos: celebrationPhotos,
      activePhotoId: fallbackPhoto.id,
    });
    setActiveCelebrationPhoto(fallbackPhoto);
    setShowCelebrationPhoto(true);
  }, [
    activeCelebrationPhoto,
    celebrationEnabled,
    celebrationPhotos,
    effectiveAttendance.checkedInAt,
  ]);

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
  const hasLongNotice = noticeBlocks.length > 3;
  const skinPalette = useMemo(
    () => getSkinPalette(companySetting.mobileSkinKey),
    [companySetting.mobileSkinKey]
  );
  const themeStyles = useMemo(() => createThemeStyles(skinPalette), [skinPalette]);

  useEffect(() => {
    setIsNoticeExpanded(false);
  }, [companySetting.noticeMessage]);

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

      if (rememberEmployeeCode) {
        saveEmployeeCode(employeeCode);
      } else {
        clearEmployeeCode();
      }

      setAuth(response);
      saveAuth(response);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setAttendance(INITIAL_STATUS);
      setAttendanceMeta({
        attendanceDate: null,
        companyName: response.user.companyName || COMPANY_NAME,
        workplaceName: response.user.workplaceName || null,
        status: null,
      });
      setCompanySetting({
        companyName: response.user.companyName || COMPANY_NAME,
        workplaceName: response.user.workplaceName || null,
        latitude: COMPANY_LOCATION.latitude,
        longitude: COMPANY_LOCATION.longitude,
        allowedRadiusMeters: COMPANY_RADIUS_METERS,
        noticeMessage: "",
        mobileSkinKey: "classic",
      });
    } catch (error) {
      showError("로그인 실패", error.message || "다시 시도해 주세요.");
    } finally {
      setLoadingLogin(false);
    }
  }

  function handleToggleRememberEmployeeCode() {
    const nextValue = !rememberEmployeeCode;
    setRememberEmployeeCode(nextValue);

    if (!nextValue) {
      clearEmployeeCode();
      return;
    }

    if (employeeCode.trim()) {
      saveEmployeeCode(employeeCode);
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

      const cameFromInvite = Boolean(invitePreview);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setPassword("");

      if (cameFromInvite) {
        clearAuth();
        setAuth(null);
        setInvitePreview(null);
        setInviteToken("");
        Alert.alert(
          "비밀번호 변경 완료",
          response.message || "비밀번호가 변경되었습니다. 이제 새 비밀번호로 로그인해 주세요."
        );
        return;
      }

      const nextAuth = {
        ...auth,
        user: {
          ...auth.user,
          passwordChangeRequired: false,
        },
      };

      setAuth(nextAuth);
      saveAuth(nextAuth);
      Alert.alert("비밀번호 변경 완료", response.message || "비밀번호가 변경되었습니다.");
    } catch (error) {
      showError("비밀번호 변경 실패", error.message || "잠시 후 다시 시도해 주세요.");
    } finally {
      setChangingPassword(false);
    }
  }

  function handleBackToLogin() {
    clearAuth();
    setAuth(null);
    setErrorMessage("");
    setCurrentPasswordInput("");
    setNewPasswordInput("");
    setConfirmPasswordInput("");
    setAttendance(INITIAL_STATUS);
    setAttendanceMeta({
      attendanceDate: null,
      companyName: companySetting.companyName || COMPANY_NAME,
      workplaceName: companySetting.workplaceName || null,
      status: null,
    });
  }

  function handleOpenInviteInApp() {
    if (!inviteToken) {
      return;
    }

    Linking.openURL(buildInviteAppUrl(inviteToken)).catch(() => {
      showError("앱 열기 실패", "앱을 열지 못했습니다. 앱이 설치되어 있는지 확인해 주세요.");
    });
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
      showRandomCelebrationPhoto();
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
    const isInviteEntry = Boolean(invitePreview);

    return (
      <SafeAreaView style={[styles.authContainer, themeStyles.authContainer]}>
        <StatusBar style="dark" />
        <View style={[styles.authCard, themeStyles.authCard]}>
          <Text style={[styles.title, themeStyles.title]}>출퇴근 체크</Text>
          <Text style={[styles.subtitle, themeStyles.subtitle]}>
            {isInviteEntry
              ? "초대 링크로 들어왔습니다. 사번이 자동으로 입력되어 있습니다. 로그인하면 바로 비밀번호 변경 단계로 이동합니다."
              : `${getDisplayLocationName(attendanceMeta, companySetting)} 출퇴근 서비스입니다. 로그인 후 브라우저에서 현재 위치를 확인하고 출근과 퇴근을 기록해 보세요. 로그인 상태는 같은 단말에서 최대 1년 유지됩니다.`}
          </Text>
          {errorMessage ? (
            <View style={styles.authErrorBox}>
              <Text style={styles.authErrorText}>{errorMessage}</Text>
            </View>
          ) : null}
          {loadingInvite ? (
            <ActivityIndicator color="#1463ff" />
          ) : invitePreview ? (
            <View style={styles.inviteSummaryBox}>
              <Text style={styles.inviteSummaryLine}>{invitePreview.companyName}</Text>
              <Text style={styles.inviteSummaryLine}>{invitePreview.employeeName} ({invitePreview.employeeCode})</Text>
              <Text style={styles.inviteSummaryMeta}>{invitePreview.workplaceName}</Text>
            </View>
          ) : null}
          <TextInput
            autoCapitalize="none"
            onChangeText={setEmployeeCode}
            placeholder="사번"
            placeholderTextColor="#8c98ad"
            editable={!invitePreview}
            style={[styles.input, themeStyles.input]}
            value={employeeCode}
          />
          {!isInviteEntry ? (
            <TextInput
              ref={passwordInputRef}
              onChangeText={setPassword}
              placeholder="비밀번호"
              placeholderTextColor="#8c98ad"
              autoComplete="off"
              secureTextEntry
              style={[styles.input, themeStyles.input]}
              value={password}
            />
          ) : null}
          <Pressable
            onPress={handleToggleRememberEmployeeCode}
            style={styles.checkboxRow}
          >
            <View style={[styles.checkbox, rememberEmployeeCode && styles.checkboxChecked, rememberEmployeeCode && themeStyles.checkboxChecked]}>
              {rememberEmployeeCode ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxLabel}>아이디 저장</Text>
          </Pressable>
          <Pressable
            disabled={loadingLogin}
            onPress={handleLogin}
            style={[styles.primaryButton, themeStyles.primaryButton, loadingLogin && styles.buttonDisabled]}
          >
            {loadingLogin ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>{isInviteEntry ? "등록 시작" : "로그인"}</Text>
            )}
          </Pressable>
          {isInviteEntry ? (
            <Pressable
              disabled={loadingLogin}
              onPress={handleOpenInviteInApp}
              style={[styles.backButton, themeStyles.backButton, loadingLogin && styles.buttonDisabled]}
            >
              <Text style={[styles.backButtonText, themeStyles.backButtonText]}>앱에서 이어서 열기</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  if (auth.user?.passwordChangeRequired) {
    return (
      <SafeAreaView style={[styles.authContainer, themeStyles.authContainer]}>
        <StatusBar style="dark" />
        <View style={[styles.authCard, themeStyles.authCard]}>
          <Text style={[styles.title, themeStyles.title]}>비밀번호 변경</Text>
          <Text style={[styles.subtitle, themeStyles.subtitle]}>
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
            style={[styles.input, themeStyles.input]}
            value={newPasswordInput}
          />
          <TextInput
            onChangeText={setConfirmPasswordInput}
            placeholder="새 비밀번호 확인"
            placeholderTextColor="#8c98ad"
            secureTextEntry
            style={[styles.input, themeStyles.input]}
            value={confirmPasswordInput}
          />
          <Pressable
            disabled={changingPassword}
            onPress={handleChangePassword}
            style={[styles.primaryButton, themeStyles.primaryButton, changingPassword && styles.buttonDisabled]}
          >
            {changingPassword ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryButtonText}>비밀번호 변경</Text>
            )}
          </Pressable>
          <Pressable
            disabled={changingPassword}
            onPress={handleBackToLogin}
            style={[styles.backButton, themeStyles.backButton, changingPassword && styles.buttonDisabled]}
          >
            <Text style={[styles.backButtonText, themeStyles.backButtonText]}>뒤로가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, themeStyles.container]}>
      <StatusBar style="dark" />
      <Modal
        animationType="fade"
        transparent
        visible={showCheckOutConfirm}
        onRequestClose={() => setShowCheckOutConfirm(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={[styles.modalTitle, themeStyles.modalTitle]}>퇴근 확인</Text>
            <Text style={[styles.modalDescription, themeStyles.modalDescription]}>지금 퇴근 처리하시겠어요?</Text>
            <View style={styles.modalButtonRow}>
              <Pressable
                onPress={() => setShowCheckOutConfirm(false)}
                style={[styles.modalButton, styles.modalSecondaryButton, themeStyles.modalSecondaryButton]}
              >
                <Text style={styles.modalSecondaryButtonText}>취소</Text>
              </Pressable>
              <Pressable
                onPress={submitCheckOut}
                style={[styles.modalButton, styles.modalPrimaryButton, themeStyles.modalPrimaryButton]}
              >
                <Text style={styles.modalPrimaryButtonText}>퇴근하기</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={showMenu}
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setShowMenu(false)}>
          <View style={styles.menuCard}>
            <Pressable
              onPress={() => {
                setShowMenu(false);
                setShowImageSettings(true);
              }}
              style={styles.menuItem}
            >
              <Text style={styles.menuItemTitle}>이미지 설정</Text>
              <Text style={styles.menuItemMeta}>
                {celebrationEnabled ? `켜짐 · ${celebrationPhotos.length}장` : "꺼짐"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={showImageSettings}
        onRequestClose={() => setShowImageSettings(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.sheetTitle}>이미지 설정</Text>
                <Text style={styles.sheetDescription}>
                  출근 완료 후 지도 영역 대신 랜덤 이미지를 보여줄지 설정합니다.
                </Text>
              </View>
              <Pressable
                onPress={() => setShowImageSettings(false)}
                style={styles.sheetCloseButton}
              >
                <Text style={styles.sheetCloseButtonText}>닫기</Text>
              </Pressable>
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingTextWrap}>
                <Text style={styles.settingTitle}>이미지 표시</Text>
                <Text style={styles.settingDescription}>
                  켜두면 출근 완료 후 등록한 이미지 중 한 장이 랜덤으로 표시됩니다.
                </Text>
              </View>
              <Switch
                onValueChange={handleToggleCelebrationEnabled}
                trackColor={{ false: "#cbd5e1", true: "#93c5fd" }}
                thumbColor={celebrationEnabled ? "#1463ff" : "#ffffff"}
                value={celebrationEnabled}
              />
            </View>

            <View style={styles.settingSummaryRow}>
              <Text style={styles.settingSummaryText}>
                등록된 이미지 {celebrationPhotos.length}/{MAX_CELEBRATION_PHOTOS}
              </Text>
            </View>

            <View style={styles.imageActionRow}>
              <Pressable
                disabled={uploadingCelebrationPhotos}
                onPress={handleOpenImagePicker}
                style={[styles.imageActionPrimaryButton, uploadingCelebrationPhotos && styles.buttonDisabled]}
              >
                {uploadingCelebrationPhotos ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.imageActionPrimaryButtonText}>이미지 추가</Text>
                )}
              </Pressable>
              <Pressable
                disabled={!celebrationPhotos.length}
                onPress={handleClearCelebrationPhotos}
                style={[styles.imageActionSecondaryButton, !celebrationPhotos.length && styles.buttonDisabled]}
              >
                <Text style={styles.imageActionSecondaryButtonText}>모두 삭제</Text>
              </Pressable>
            </View>

            {celebrationPhotos.length ? (
              <ScrollView
                contentContainerStyle={styles.imagePreviewRow}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {celebrationPhotos.map((photo, index) => (
                  <View key={photo.id} style={styles.imagePreviewCard}>
                    <Image source={{ uri: photo.dataUrl }} style={styles.imagePreviewImage} />
                    <Pressable
                      onPress={() => handleRemoveCelebrationPhoto(photo.id)}
                      style={styles.imagePreviewDeleteButton}
                    >
                      <Text style={styles.imagePreviewDeleteButtonText}>×</Text>
                    </Pressable>
                    <View style={styles.imagePreviewBadge}>
                      <Text style={styles.imagePreviewBadgeText}>{index + 1}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.imageEmptyText}>
                아직 등록된 이미지가 없습니다. 원하는 사진을 올려두면 출근 완료 후 랜덤으로 보여드립니다.
              </Text>
            )}
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
          <Text style={[styles.welcomeText, themeStyles.headerText]}>
            {auth.user.name} <Text style={[styles.welcomeCode, themeStyles.welcomeCode]}>({auth.user.employeeCode})</Text>
          </Text>
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.badge, themeStyles.badge]}>
            <Text style={[styles.badgeText, themeStyles.badgeText]}>
              {DEMO_MODE
                ? distance == null
                  ? "DEMO"
                  : `DEMO ${Math.round(distance)}m`
                : distance == null
                  ? "위치 확인 중"
                  : `${Math.round(distance)}m`}
            </Text>
          </View>
          <Pressable onPress={() => setShowMenu(true)} style={styles.menuButton}>
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
            <View style={styles.menuBar} />
          </Pressable>
        </View>
      </View>

      <View style={styles.attendanceSummaryRow}>
        <View style={[styles.attendanceSummaryCard, themeStyles.attendanceSummaryCard]}>
          <Text style={[styles.attendanceSummaryLabel, themeStyles.attendanceSummaryLabel]}>출근</Text>
          <Text style={[styles.attendanceSummaryValue, themeStyles.attendanceSummaryValue]}>{formatTime(attendance.checkedInAt)}</Text>
        </View>
        <View style={[styles.attendanceSummaryCard, themeStyles.attendanceSummaryCard]}>
          <Text style={[styles.attendanceSummaryLabel, themeStyles.attendanceSummaryLabel]}>퇴근</Text>
          <Text style={[styles.attendanceSummaryValue, themeStyles.attendanceSummaryValue]}>{formatTime(attendance.checkedOutAt)}</Text>
        </View>
      </View>

      <View style={[styles.mapCard, themeStyles.mapCard]}>
        {showCelebrationPhoto && activeCelebrationPhoto ? (
          <View style={styles.celebrationPhotoWrap}>
            <Image
              resizeMode="cover"
              source={{ uri: activeCelebrationPhoto.dataUrl }}
              style={styles.celebrationPhoto}
            />
            <View style={styles.celebrationPhotoScrim} />
            <Pressable
              onPress={() => setShowCelebrationPhoto(false)}
              style={styles.celebrationPhotoCloseButton}
            >
              <Text style={styles.celebrationPhotoCloseButtonText}>닫기</Text>
            </Pressable>
            <View style={styles.celebrationPhotoCaption}>
              <Text style={styles.celebrationPhotoCaptionEyebrow}>오늘의 랜덤 이미지</Text>
              <Text style={styles.celebrationPhotoCaptionTitle}>출근 완료를 축하해요</Text>
            </View>
          </View>
        ) : loadingLocation ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#1463ff" />
            <Text style={[styles.helperText, themeStyles.helperText]}>현재 위치를 확인하고 있습니다.</Text>
          </View>
        ) : locationPermission !== "granted" ? (
          <View style={styles.centerState}>
            <Text style={[styles.helperTitle, themeStyles.helperTitle]}>위치 권한이 필요합니다.</Text>
            <Text style={[styles.helperText, themeStyles.helperText]}>
              {Platform.OS === "web"
                ? webLocationHelpText
                : "권한을 허용하면 사업장 반경 안에서만 출근 버튼이 활성화됩니다."}
            </Text>
            <Pressable
              onPress={handleRetryLocationPermission}
              style={[styles.permissionButton, themeStyles.permissionButton]}
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
            companyName={getDisplayLocationName(attendanceMeta, companySetting)}
            companyRadiusMeters={companySetting.allowedRadiusMeters}
            currentLocation={currentLocation}
            style={styles.map}
          />
        )}
      </View>

      <View style={[styles.bottomPanel, themeStyles.bottomPanel]}>
        <View style={styles.noticeHeaderRow}>
          <Text style={[styles.panelTitle, themeStyles.panelTitle]}>공지사항</Text>
          {hasLongNotice ? (
            <Pressable
              onPress={() => setIsNoticeExpanded((prev) => !prev)}
              style={styles.noticeToggleButton}
            >
              <Text style={styles.noticeToggleButtonText}>
                {isNoticeExpanded ? "줄이기" : "늘리기"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {noticeBlocks.length > 0 ? (
          <View
            style={[
              styles.noticeViewport,
              isNoticeExpanded ? styles.noticeViewportExpanded : styles.noticeViewportCollapsed,
            ]}
          >
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={isNoticeExpanded}
            >
              <View style={styles.noticeContent}>
                {noticeBlocks.map((block) => {
                  if (block.type === "heading") {
                    return (
                      <Text key={block.key} style={[styles.noticeHeading, themeStyles.noticeHeading]}>
                        {block.text}
                      </Text>
                    );
                  }

                  if (block.type === "bullet") {
                    return (
                      <View key={block.key} style={styles.noticeBulletRow}>
                        <Text style={[styles.noticeBulletMark, themeStyles.noticeBulletMark]}>•</Text>
                        <View style={styles.noticeBulletTextWrap}>
                          {renderNoticeInline(
                            block.text,
                            [styles.noticeBulletText, themeStyles.noticeBulletText],
                            [styles.noticeBoldText, themeStyles.noticeBoldText],
                            [styles.noticeLinkText, themeStyles.noticeLinkText]
                          )}
                        </View>
                      </View>
                    );
                  }

                  return (
                    <View key={block.key} style={styles.noticeParagraphWrap}>
                      {renderNoticeInline(
                        block.text,
                        [styles.panelDescription, themeStyles.panelDescription],
                        [styles.noticeBoldText, themeStyles.noticeBoldText],
                        [styles.noticeLinkText, themeStyles.noticeLinkText]
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : (
          <Text style={[styles.panelDescription, themeStyles.panelDescription]}>등록된 공지사항이 없습니다.</Text>
        )}

        <View style={styles.actionRow}>
          <Pressable
            disabled={!canCheckIn}
            onPress={handleCheckIn}
            style={[styles.checkInButton, styles.actionButton, themeStyles.checkInButton, !canCheckIn && styles.buttonDisabled]}
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
            style={[styles.secondaryButton, styles.actionButton, themeStyles.secondaryButton, !canCheckOut && styles.buttonDisabled]}
          >
            {submittingAttendance && attendance.checkedInAt && !attendance.checkedOutAt ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.secondaryButtonText}>퇴근하기</Text>
            )}
          </Pressable>
        </View>
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
  inviteSummaryBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  inviteSummaryLine: {
    color: "#172033",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 4,
  },
  inviteSummaryMeta: {
    color: "#5a657a",
    fontSize: 13,
    lineHeight: 19,
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
  checkboxRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  checkbox: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: "#1463ff",
    borderColor: "#1463ff",
  },
  checkboxMark: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  checkboxLabel: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "600",
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
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
  menuCard: {
    position: "absolute",
    right: 16,
    top: 78,
    width: 184,
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  menuItem: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#f8fafc",
  },
  menuItemTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  menuItemMeta: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: "82%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 54,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#d7deea",
    marginBottom: 14,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 18,
  },
  sheetHeaderTextWrap: {
    flex: 1,
  },
  sheetTitle: {
    color: "#172033",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 6,
  },
  sheetDescription: {
    color: "#5b667a",
    fontSize: 14,
    lineHeight: 21,
  },
  sheetCloseButton: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sheetCloseButtonText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  settingTextWrap: {
    flex: 1,
  },
  settingTitle: {
    color: "#172033",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 4,
  },
  settingDescription: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 19,
  },
  settingSummaryRow: {
    marginBottom: 12,
  },
  settingSummaryText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
  },
  imageActionRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  imageActionPrimaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#1463ff",
    alignItems: "center",
    justifyContent: "center",
  },
  imageActionPrimaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  imageActionSecondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "#edf1f7",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  imageActionSecondaryButtonText: {
    color: "#455468",
    fontSize: 14,
    fontWeight: "700",
  },
  imagePreviewRow: {
    gap: 10,
    paddingBottom: 10,
    paddingRight: 20,
  },
  imagePreviewCard: {
    width: 96,
    height: 96,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#dbe4f0",
    position: "relative",
  },
  imagePreviewImage: {
    width: "100%",
    height: "100%",
  },
  imagePreviewDeleteButton: {
    position: "absolute",
    left: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(220,38,38,0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7f1d1d",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  imagePreviewDeleteButtonText: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "800",
  },
  imagePreviewBadge: {
    position: "absolute",
    right: 8,
    top: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.78)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  imagePreviewBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  imageEmptyText: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  welcomeText: {
    color: "#172033",
    fontSize: 24,
    fontWeight: "800",
  },
  welcomeCode: {
    color: "#52607a",
    fontSize: 18,
    fontWeight: "700",
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  menuButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  menuBar: {
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: "#172033",
    marginVertical: 1.5,
  },
  mapCard: {
    flex: 1,
    marginHorizontal: 16,
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: "#dfe7f4",
    minHeight: 360,
  },
  map: {
    flex: 1,
  },
  celebrationPhotoWrap: {
    flex: 1,
    position: "relative",
  },
  celebrationPhoto: {
    width: "100%",
    height: "100%",
  },
  celebrationPhotoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.12)",
  },
  celebrationPhotoCloseButton: {
    position: "absolute",
    right: 14,
    top: 14,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  celebrationPhotoCloseButtonText: {
    color: "#172033",
    fontSize: 14,
    fontWeight: "800",
  },
  celebrationPhotoCaption: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: "rgba(15,23,42,0.58)",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  celebrationPhotoCaptionEyebrow: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  celebrationPhotoCaptionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
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
    paddingTop: 14,
    paddingBottom: 18,
  },
  attendanceSummaryRow: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  attendanceSummaryCard: {
    flex: 1,
    backgroundColor: "#f4f7fb",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#dbe4f0",
  },
  attendanceSummaryLabel: {
    color: "#6a7487",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  attendanceSummaryValue: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  panelTitle: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
  },
  noticeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  noticeToggleButton: {
    backgroundColor: "#edf3ff",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  noticeToggleButtonText: {
    color: "#1463ff",
    fontSize: 13,
    fontWeight: "800",
  },
  panelDescription: {
    color: "#59657a",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  noticeViewport: {
    overflow: "hidden",
    marginBottom: 18,
  },
  noticeViewportCollapsed: {
    maxHeight: 88,
  },
  noticeViewportExpanded: {
    maxHeight: 180,
  },
  noticeContent: {
    gap: 8,
    minHeight: 72,
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
  backButton: {
    alignItems: "center",
    borderColor: "#cfd8e6",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 52,
  },
  backButtonText: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "700",
  },
  checkInButton: {
    alignItems: "center",
    backgroundColor: "#1463ff",
    borderRadius: 22,
    justifyContent: "center",
    minHeight: 62,
  },
  checkInButtonText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#172033",
    borderRadius: 18,
    justifyContent: "center",
    minHeight: 62,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
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
