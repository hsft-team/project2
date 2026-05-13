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
  useWindowDimensions,
  View,
} from "react-native";

import {
  COMPANY_LOCATION,
  COMPANY_NAME,
  COMPANY_RADIUS_METERS,
} from "./src/constants/company";
import AttendanceMap from "./src/components/AttendanceMap";
import {
  cancelWorkRequest,
  checkIn,
  checkOut,
  changePassword,
  createWorkRequest,
  DEMO_MODE,
  getCompanySetting,
  getPublicCompanySetting,
  getTodayAttendance,
  getWorkRequests,
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
const NOTICE_ACK_STORAGE_PREFIX = "attendance-notice-ack";

function createInitialAttendanceMeta(overrides = {}) {
  return {
    attendanceDate: null,
    companyName: COMPANY_NAME,
    workplaceName: null,
    status: null,
    ...overrides,
  };
}

function createInitialCompanySetting(overrides = {}) {
  return {
    companyName: COMPANY_NAME,
    workplaceName: null,
    latitude: COMPANY_LOCATION.latitude,
    longitude: COMPANY_LOCATION.longitude,
    allowedRadiusMeters: COMPANY_RADIUS_METERS,
    noticeMessage: "",
    mobileSkinKey: "classic",
    workRequestApprovalRequired: true,
    ...overrides,
  };
}

function createInitialWorkRequestForm() {
  return {
    requestType: "VACATION",
    requestDate: getSeoulNowInfo().date,
    halfDayType: "MORNING",
    occasionType: "SELF_MARRIAGE",
    earlyLeaveMinutes: "30",
    reason: "",
  };
}

function getWorkRequestTypeLabel(type) {
  switch (type) {
    case "VACATION":
      return "휴가";
    case "HALF_DAY":
      return "반차";
    case "EARLY_LEAVE":
      return "유연근무";
    case "SPECIAL_LEAVE":
      return "경조사";
    default:
      return "신청";
  }
}

function getOccasionTypeLabel(type) {
  switch (type) {
    case "SELF_MARRIAGE":
      return "본인 결혼";
    case "CHILD_MARRIAGE":
      return "자녀 결혼";
    case "SPOUSE_CHILDBIRTH":
      return "배우자 출산";
    case "FAMILY_DEATH":
      return "가족 사망";
    case "GRANDPARENT_DEATH":
      return "조부모 사망";
    case "SIBLING_DEATH":
      return "형제자매 사망";
    case "OTHER":
      return "기타 경조사";
    default:
      return "";
  }
}

function formatFlexibleWorkMinutes(minutes) {
  const totalMinutes = Number(minutes || 0);
  if (!totalMinutes) {
    return "";
  }
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}시간 ${remainingMinutes}분`;
  }
  if (hours > 0) {
    return `${hours}시간`;
  }
  return `${remainingMinutes}분`;
}

function formatVacationDays(days) {
  if (Number.isInteger(days)) {
    return `${days}일`;
  }
  return `${days.toFixed(1).replace(/\.0$/, "")}일`;
}

function getWorkRequestDetailText(request) {
  const details = [];
  if (request.halfDayTypeLabel) {
    details.push(request.halfDayTypeLabel);
  }
  if (request.occasionTypeLabel) {
    details.push(request.occasionTypeLabel);
  }
  if (request.earlyLeaveMinutes) {
    details.push(`${formatFlexibleWorkMinutes(request.earlyLeaveMinutes)} 유연근무`);
  }
  return details.join(" · ");
}

function createMonthCursor(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateKey(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return getSeoulNowInfo().date;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNoticeHash(message) {
  const normalized = message?.trim();
  if (!normalized) {
    return "";
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function getNoticeAckKey(employeeCode, noticeMessage) {
  const noticeHash = getNoticeHash(noticeMessage);
  const normalizedEmployeeCode = employeeCode?.trim();
  if (!noticeHash || !normalizedEmployeeCode) {
    return "";
  }

  return `${NOTICE_ACK_STORAGE_PREFIX}:${normalizedEmployeeCode}:${noticeHash}`;
}

function isNoticeAcknowledged(ackKey) {
  if (!ackKey || typeof window === "undefined" || !window.localStorage) {
    return true;
  }

  return window.localStorage.getItem(ackKey) === "1";
}

function acknowledgeNotice(ackKey) {
  if (!ackKey || typeof window === "undefined" || !window.localStorage) {
    return;
  }

  window.localStorage.setItem(ackKey, "1");
}

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

function formatDateTime(dateString) {
  if (!dateString) {
    return "-";
  }

  return new Date(dateString).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
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
    floatingCard: { backgroundColor: palette.surface, borderColor: palette.border },
    workplaceTitle: { color: palette.primary },
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
  const previousCheckedInAtRef = useRef(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
  const [showWorkRequestModal, setShowWorkRequestModal] = useState(false);
  const [showVacationInfoModal, setShowVacationInfoModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [locationPermission, setLocationPermission] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [submittingAttendance, setSubmittingAttendance] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [invitePreview, setInvitePreview] = useState(null);
  const [attendance, setAttendance] = useState(INITIAL_STATUS);
  const [attendanceMeta, setAttendanceMeta] = useState(createInitialAttendanceMeta());
  const [errorMessage, setErrorMessage] = useState("");
  const [companySetting, setCompanySetting] = useState(createInitialCompanySetting());
  const [celebrationEnabled, setCelebrationEnabled] = useState(false);
  const [celebrationPhotos, setCelebrationPhotos] = useState([]);
  const [uploadingCelebrationPhotos, setUploadingCelebrationPhotos] = useState(false);
  const [activeCelebrationPhoto, setActiveCelebrationPhoto] = useState(null);
  const [showCelebrationPhoto, setShowCelebrationPhoto] = useState(false);
  const [bottomLayerHeight, setBottomLayerHeight] = useState(0);
  const [mapRecenterRequest, setMapRecenterRequest] = useState(0);
  const [workRequestForm, setWorkRequestForm] = useState(createInitialWorkRequestForm());
  const [workRequests, setWorkRequests] = useState([]);
  const [loadingWorkRequests, setLoadingWorkRequests] = useState(false);
  const [submittingWorkRequest, setSubmittingWorkRequest] = useState(false);
  const [workRequestCalendarCursor, setWorkRequestCalendarCursor] = useState(createMonthCursor(getSeoulNowInfo().date));
  const [vacationCalendarCursor, setVacationCalendarCursor] = useState(createMonthCursor());
  const [selectedVacationDate, setSelectedVacationDate] = useState(getSeoulNowInfo().date);
  const authRef = useRef(null);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    const savedEmployeeCode = loadEmployeeCode();
    if (savedEmployeeCode) {
      setEmployeeCode(savedEmployeeCode);
      setRememberEmployeeCode(true);
    }

    const savedAuth = loadAuth();
    if (savedAuth?.token) {
      setAuth(savedAuth);
      setAttendanceMeta(createInitialAttendanceMeta({
        companyName: savedAuth.user?.companyName || COMPANY_NAME,
        workplaceName: savedAuth.user?.workplaceName || null,
      }));
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    const savedSettings = loadCelebrationSettings();
    setCelebrationEnabled(savedSettings.enabled);
    setCelebrationPhotos(savedSettings.photos);
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
      if (authRef.current?.token) {
        return;
      }

      const nextCompanySetting = await getPublicCompanySetting();
      if (!active || !nextCompanySetting || authRef.current?.token) {
        return;
      }

      setCompanySetting(createInitialCompanySetting(nextCompanySetting));
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

  function confirmAction(title, message, onConfirm, confirmStyle = "destructive") {
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
        style: confirmStyle,
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
      return null;
    }

    const availablePhotos =
      photoCandidates.length > 1 && activeCelebrationPhoto
        ? photoCandidates.filter((photo) => photo.id !== activeCelebrationPhoto.id)
        : photoCandidates;
    const nextPhoto = pickRandomCelebrationPhoto(availablePhotos);
    if (!nextPhoto) {
      return null;
    }

    persistCelebrationSettings({
      enabled: celebrationEnabled,
      photos: photoCandidates,
      activePhotoId: nextPhoto.id,
    });
    setActiveCelebrationPhoto(nextPhoto);
    setShowCelebrationPhoto(true);
    return nextPhoto;
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

  useEffect(() => {
    const previousCheckedInAt = previousCheckedInAtRef.current;

    if (
      !previousCheckedInAt &&
      effectiveAttendance.checkedInAt &&
      celebrationEnabled &&
      celebrationPhotos.length
    ) {
      showRandomCelebrationPhoto(celebrationPhotos);
    }

    previousCheckedInAtRef.current = effectiveAttendance.checkedInAt || null;
  }, [
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
  const noticeAckKey = useMemo(
    () => getNoticeAckKey(auth?.user?.employeeCode, companySetting.noticeMessage),
    [auth?.user?.employeeCode, companySetting.noticeMessage]
  );
  const skinPalette = useMemo(
    () => getSkinPalette(companySetting.mobileSkinKey),
    [companySetting.mobileSkinKey]
  );
  const themeStyles = useMemo(() => createThemeStyles(skinPalette), [skinPalette]);
  const collapsedNoticeHeight = useMemo(
    () => Math.max(38, Math.min(52, Math.round(windowHeight * 0.062))),
    [windowHeight]
  );
  const workRequestCalendarData = useMemo(() => {
    const year = workRequestCalendarCursor.getFullYear();
    const month = workRequestCalendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(year, month, 1 - firstDay.getDay());
    const todayKey = getSeoulNowInfo().date;
    const requestsByDate = workRequests.reduce((accumulator, request) => {
      if (!request.requestDate) {
        return accumulator;
      }
      if (!accumulator[request.requestDate]) {
        accumulator[request.requestDate] = [];
      }
      accumulator[request.requestDate].push(request);
      return accumulator;
    }, {});
    const weeks = [];

    for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
      const week = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + weekIndex * 7 + dayIndex);
        const dateKey = toDateKey(date);
        const dayRequests = requestsByDate[dateKey] || [];
        week.push({
          dateKey,
          day: date.getDate(),
          inMonth: date.getMonth() === month,
          today: dateKey === todayKey,
          selected: dateKey === workRequestForm.requestDate,
          requests: dayRequests,
          approvedCount: dayRequests.filter((request) => request.status === "APPROVED").length,
          pendingCount: dayRequests.filter((request) => request.status === "PENDING").length,
        });
      }
      weeks.push(week);
    }

    return {
      title: `${year}년 ${month + 1}월`,
      weeks,
    };
  }, [workRequestCalendarCursor, workRequestForm.requestDate, workRequests]);
  const vacationCalendarData = useMemo(() => {
    const year = vacationCalendarCursor.getFullYear();
    const month = vacationCalendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDate = new Date(year, month, 1 - firstDay.getDay());
    const todayKey = getSeoulNowInfo().date;
    const requestsByDate = workRequests.reduce((accumulator, request) => {
      if (!request.requestDate) {
        return accumulator;
      }
      if (!accumulator[request.requestDate]) {
        accumulator[request.requestDate] = [];
      }
      accumulator[request.requestDate].push(request);
      return accumulator;
    }, {});
    const weeks = [];

    for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
      const week = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + weekIndex * 7 + dayIndex);
        const dateKey = toDateKey(date);
        const dayRequests = requestsByDate[dateKey] || [];
        week.push({
          dateKey,
          day: date.getDate(),
          inMonth: date.getMonth() === month,
          today: dateKey === todayKey,
          selected: dateKey === selectedVacationDate,
          requests: dayRequests,
          approvedCount: dayRequests.filter((request) => request.status === "APPROVED").length,
          pendingCount: dayRequests.filter((request) => request.status === "PENDING").length,
        });
      }
      weeks.push(week);
    }

    return {
      title: `${year}년 ${month + 1}월`,
      weeks,
      selectedRequests: requestsByDate[selectedVacationDate] || [],
    };
  }, [selectedVacationDate, vacationCalendarCursor, workRequests]);
  const vacationUsageSummary = useMemo(() => {
    return workRequests
      .filter((request) => request.status === "APPROVED")
      .reduce((summary, request) => {
        if (request.requestType === "VACATION") {
          return {
            ...summary,
            annualLeaveDays: summary.annualLeaveDays + 1,
          };
        }
        if (request.requestType === "HALF_DAY") {
          return {
            ...summary,
            annualLeaveDays: summary.annualLeaveDays + 0.5,
          };
        }
        if (request.requestType === "SPECIAL_LEAVE") {
          return {
            ...summary,
            otherLeaveDays: summary.otherLeaveDays + 1,
          };
        }
        return summary;
      }, { annualLeaveDays: 0, otherLeaveDays: 0 });
  }, [workRequests]);
  const isLandscapeLayout = windowWidth > windowHeight;
  const bottomLayerResponsiveStyle = isLandscapeLayout
    ? {
        left: Math.max(16, windowWidth - 420),
        right: 16,
      }
    : null;
  const mapDistanceResponsiveStyle = isLandscapeLayout
    ? { top: 82 }
    : { bottom: bottomLayerHeight ? bottomLayerHeight + 26 : 352 };

  useEffect(() => {
    if (!auth || !noticeAckKey || !noticeBlocks.length) {
      return;
    }

    if (!isNoticeAcknowledged(noticeAckKey)) {
      setShowNoticeModal(true);
    }
  }, [auth, noticeAckKey, noticeBlocks.length]);

  function handleCloseNoticeModal() {
    acknowledgeNotice(noticeAckKey);
    setShowNoticeModal(false);
  }

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
      setAttendanceMeta(createInitialAttendanceMeta({
        companyName: response.user.companyName || COMPANY_NAME,
        workplaceName: response.user.workplaceName || null,
      }));
      setCompanySetting(createInitialCompanySetting({
        companyName: response.user.companyName || COMPANY_NAME,
        workplaceName: response.user.workplaceName || null,
      }));
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
    setShowNoticeModal(false);
    setShowWorkRequestModal(false);
    setShowVacationInfoModal(false);
    setAttendanceMeta(createInitialAttendanceMeta());
    setCompanySetting(createInitialCompanySetting());
    const initialForm = createInitialWorkRequestForm();
    setWorkRequestForm(initialForm);
    setWorkRequestCalendarCursor(createMonthCursor(initialForm.requestDate));
    setWorkRequests([]);
  }

  async function loadMyWorkRequests() {
    if (!auth?.token) {
      return;
    }

    try {
      setLoadingWorkRequests(true);
      const response = await getWorkRequests({ token: auth.token });
      setWorkRequests(response.requests || []);
    } catch (error) {
      showError("휴가 정보 조회 실패", error.message || "잠시 후 다시 시도해 주세요.");
    } finally {
      setLoadingWorkRequests(false);
    }
  }

  async function handleOpenWorkRequestModal() {
    setShowMenu(false);
    setWorkRequestCalendarCursor(createMonthCursor(workRequestForm.requestDate));
    setShowWorkRequestModal(true);
    await loadMyWorkRequests();
  }

  async function handleOpenVacationInfoModal() {
    const today = getSeoulNowInfo().date;
    setShowMenu(false);
    setSelectedVacationDate(today);
    setVacationCalendarCursor(createMonthCursor(today));
    setShowVacationInfoModal(true);
    await loadMyWorkRequests();
  }

  function moveVacationCalendarMonth(offset) {
    setVacationCalendarCursor((current) => new Date(
      current.getFullYear(),
      current.getMonth() + offset,
      1
    ));
  }

  function moveWorkRequestCalendarMonth(offset) {
    setWorkRequestCalendarCursor((current) => new Date(
      current.getFullYear(),
      current.getMonth() + offset,
      1
    ));
  }

  function selectWorkRequestDate(dateKey) {
    setWorkRequestForm((prev) => ({ ...prev, requestDate: dateKey }));
    setWorkRequestCalendarCursor(createMonthCursor(dateKey));
  }

  function adjustFlexibleWorkMinutes(delta) {
    setWorkRequestForm((prev) => {
      const currentMinutes = Number(prev.earlyLeaveMinutes || 30);
      const nextMinutes = Math.max(30, Math.min(480, currentMinutes + delta));
      return {
        ...prev,
        earlyLeaveMinutes: String(nextMinutes),
      };
    });
  }

  async function handleSubmitWorkRequest() {
    if (!auth?.token) {
      return;
    }

    const requestTypeLabel = getWorkRequestTypeLabel(workRequestForm.requestType);
    const requestDetails = [];
    requestDetails.push(`날짜: ${workRequestForm.requestDate}`);
    requestDetails.push(`유형: ${requestTypeLabel}`);
    if (workRequestForm.requestType === "HALF_DAY") {
      requestDetails.push(`구분: ${workRequestForm.halfDayType === "MORNING" ? "오전 반차" : "오후 반차"}`);
    }
    if (workRequestForm.requestType === "SPECIAL_LEAVE") {
      requestDetails.push(`경조사: ${getOccasionTypeLabel(workRequestForm.occasionType)}`);
    }
    if (workRequestForm.requestType === "EARLY_LEAVE") {
      requestDetails.push(`시간: ${formatFlexibleWorkMinutes(workRequestForm.earlyLeaveMinutes)}`);
    }
    if (workRequestForm.reason.trim()) {
      requestDetails.push(`사유: ${workRequestForm.reason.trim()}`);
    }

    confirmAction("휴가 신청 확인", `${requestDetails.join("\n")}\n\n이 내용으로 신청할까요?`, async () => {
      try {
        setSubmittingWorkRequest(true);
        const response = await createWorkRequest({
          token: auth.token,
          requestType: workRequestForm.requestType,
          requestDate: workRequestForm.requestDate,
          halfDayType: workRequestForm.requestType === "HALF_DAY" ? workRequestForm.halfDayType : null,
          occasionType: workRequestForm.requestType === "SPECIAL_LEAVE" ? workRequestForm.occasionType : null,
          earlyLeaveMinutes: workRequestForm.requestType === "EARLY_LEAVE"
            ? Number(workRequestForm.earlyLeaveMinutes || 0)
            : null,
          reason: workRequestForm.reason,
        });
        const initialForm = createInitialWorkRequestForm();
        setWorkRequestForm(initialForm);
        setWorkRequestCalendarCursor(createMonthCursor(initialForm.requestDate));
        await loadMyWorkRequests();
        Alert.alert("휴가 신청 완료", response.message || "신청이 등록되었습니다.");
      } catch (error) {
        showError("휴가 신청 실패", error.message || "잠시 후 다시 시도해 주세요.");
      } finally {
        setSubmittingWorkRequest(false);
      }
    }, "default");
  }

  async function handleCancelWorkRequest(requestId) {
    if (!auth?.token) {
      return;
    }

    confirmAction("신청 취소", "이 신청을 취소하시겠어요?", async () => {
      try {
        const response = await cancelWorkRequest({ token: auth.token, requestId });
        await loadMyWorkRequests();
        Alert.alert("신청 취소 완료", response.message || "신청이 취소되었습니다.");
      } catch (error) {
        showError("신청 취소 실패", error.message || "잠시 후 다시 시도해 주세요.");
      }
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

      if (celebrationEnabled && celebrationPhotos.length) {
        const nextPhoto = showRandomCelebrationPhoto(celebrationPhotos);

        if (nextPhoto) {
          setActiveCelebrationPhoto(nextPhoto);
          setShowCelebrationPhoto(true);
        }
      }

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
              onPress={handleOpenWorkRequestModal}
              style={styles.menuItem}
            >
              <Text style={styles.menuItemTitle}>휴가 신청</Text>
              <Text style={styles.menuItemMeta}>
                {companySetting.workRequestApprovalRequired ? "승인형" : "즉시 확정"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleOpenVacationInfoModal}
              style={styles.menuItem}
            >
              <Text style={styles.menuItemTitle}>내 휴가 정보</Text>
              <Text style={styles.menuItemMeta}>달력으로 보기</Text>
            </Pressable>
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
        visible={showWorkRequestModal}
        onRequestClose={() => setShowWorkRequestModal(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.sheetTitle}>휴가 신청</Text>
                <Text style={styles.sheetDescription}>
                  휴가, 반차, 경조사, 유연근무 신청을 등록할 수 있습니다. 반차를 사용한 날에도 유연근무를 함께 신청할 수 있습니다.
                </Text>
              </View>
              <Pressable onPress={() => setShowWorkRequestModal(false)} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseButtonText}>닫기</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.workRequestScroll} contentContainerStyle={styles.workRequestScrollContent}>
              <View style={styles.workRequestNoticeCard}>
                <Text style={styles.workRequestNoticeTitle}>처리 방식</Text>
                <Text style={styles.workRequestNoticeText}>
                  {companySetting.workRequestApprovalRequired
                    ? "현재 회사 설정은 관리자 승인형입니다. 신청 후 승인되면 최종 확정됩니다."
                    : "현재 회사 설정은 즉시 확정형입니다. 신청 즉시 반영됩니다."}
                </Text>
              </View>

              <View style={styles.workRequestSection}>
                <Text style={styles.workRequestSectionTitle}>신청하기</Text>
                <View style={styles.requestTypeRow}>
                  {["VACATION", "HALF_DAY", "SPECIAL_LEAVE", "EARLY_LEAVE"].map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setWorkRequestForm((prev) => ({ ...prev, requestType: type }))}
                      style={[
                        styles.requestTypeChip,
                        workRequestForm.requestType === type && styles.requestTypeChipActive,
                      ]}
                    >
                      <Text style={[
                        styles.requestTypeChipText,
                        workRequestForm.requestType === type && styles.requestTypeChipTextActive,
                      ]}>
                        {getWorkRequestTypeLabel(type)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.workRequestDatePickerCard}>
                  <View style={styles.workRequestDatePickerHeader}>
                    <View>
                      <Text style={styles.workRequestDatePickerLabel}>신청 날짜</Text>
                      <Text style={styles.workRequestDatePickerSelected}>{workRequestForm.requestDate}</Text>
                    </View>
                    <View style={styles.workRequestDatePickerNav}>
                      <Pressable onPress={() => moveWorkRequestCalendarMonth(-1)} style={styles.calendarMoveButton}>
                        <Text style={styles.calendarMoveButtonText}>이전</Text>
                      </Pressable>
                      <Text style={styles.workRequestDatePickerMonth}>{workRequestCalendarData.title}</Text>
                      <Pressable onPress={() => moveWorkRequestCalendarMonth(1)} style={styles.calendarMoveButton}>
                        <Text style={styles.calendarMoveButtonText}>다음</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.vacationCalendarWeekdays}>
                    {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
                      <Text key={`request-weekday-${label}`} style={styles.vacationCalendarWeekday}>{label}</Text>
                    ))}
                  </View>
                  <View style={styles.workRequestDatePickerGrid}>
                    {workRequestCalendarData.weeks.map((week, weekIndex) => (
                      <View key={`request-week-${weekIndex}`} style={styles.vacationCalendarWeek}>
                        {week.map((day) => (
                          <Pressable
                            key={`request-day-${day.dateKey}`}
                            onPress={() => selectWorkRequestDate(day.dateKey)}
                            style={[
                              styles.workRequestDatePickerDay,
                              !day.inMonth && styles.vacationCalendarDayMuted,
                              day.today && styles.vacationCalendarDayToday,
                              day.selected && styles.vacationCalendarDaySelected,
                            ]}
                          >
                            <Text style={[
                              styles.vacationCalendarDayText,
                              day.selected && styles.vacationCalendarDayTextSelected,
                            ]}>
                              {day.day}
                            </Text>
                            {day.requests.length ? (
                              <View style={styles.vacationCalendarBadgeRow}>
                                <Text style={styles.vacationCalendarBadge}>{day.requests.length}건</Text>
                                {day.pendingCount ? (
                                  <Text style={styles.vacationCalendarPendingBadge}>대기</Text>
                                ) : null}
                              </View>
                            ) : null}
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>
                </View>

                {workRequestForm.requestType === "HALF_DAY" ? (
                  <View style={styles.requestTypeRow}>
                    {["MORNING", "AFTERNOON"].map((type) => (
                      <Pressable
                        key={type}
                        onPress={() => setWorkRequestForm((prev) => ({ ...prev, halfDayType: type }))}
                        style={[
                          styles.requestTypeChip,
                          workRequestForm.halfDayType === type && styles.requestTypeChipActive,
                        ]}
                      >
                        <Text style={[
                          styles.requestTypeChipText,
                          workRequestForm.halfDayType === type && styles.requestTypeChipTextActive,
                        ]}>
                          {type === "MORNING" ? "오전 반차" : "오후 반차"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {workRequestForm.requestType === "SPECIAL_LEAVE" ? (
                  <View style={styles.requestTypeRow}>
                    {[
                      "SELF_MARRIAGE",
                      "CHILD_MARRIAGE",
                      "SPOUSE_CHILDBIRTH",
                      "FAMILY_DEATH",
                      "GRANDPARENT_DEATH",
                      "SIBLING_DEATH",
                      "OTHER",
                    ].map((type) => (
                      <Pressable
                        key={type}
                        onPress={() => setWorkRequestForm((prev) => ({ ...prev, occasionType: type }))}
                        style={[
                          styles.requestTypeChip,
                          workRequestForm.occasionType === type && styles.requestTypeChipActive,
                        ]}
                      >
                        <Text style={[
                          styles.requestTypeChipText,
                          workRequestForm.occasionType === type && styles.requestTypeChipTextActive,
                        ]}>
                          {getOccasionTypeLabel(type)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {workRequestForm.requestType === "EARLY_LEAVE" ? (
                  <View style={styles.flexibleWorkStepperCard}>
                    <Text style={styles.flexibleWorkStepperLabel}>유연근무 시간</Text>
                    <View style={styles.flexibleWorkStepperRow}>
                      <Pressable
                        onPress={() => adjustFlexibleWorkMinutes(-30)}
                        style={styles.flexibleWorkStepButton}
                      >
                        <Text style={styles.flexibleWorkStepButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.flexibleWorkValueBox}>
                        <Text style={styles.flexibleWorkValueText}>{formatFlexibleWorkMinutes(workRequestForm.earlyLeaveMinutes)}</Text>
                        <Text style={styles.flexibleWorkValueMeta}>30분 단위</Text>
                      </View>
                      <Pressable
                        onPress={() => adjustFlexibleWorkMinutes(30)}
                        style={styles.flexibleWorkStepButton}
                      >
                        <Text style={styles.flexibleWorkStepButtonText}>+</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.flexibleWorkHelpText}>최소 30분, 최대 480분까지 신청할 수 있습니다.</Text>
                  </View>
                ) : null}

                <TextInput
                  value={workRequestForm.reason}
                  onChangeText={(value) => setWorkRequestForm((prev) => ({ ...prev, reason: value }))}
                  placeholder="사유를 입력해 주세요. (선택)"
                  placeholderTextColor="#8c98ad"
                  multiline
                  style={[styles.input, styles.workRequestInput, styles.workRequestReasonInput]}
                />

                <Pressable
                  disabled={submittingWorkRequest}
                  onPress={handleSubmitWorkRequest}
                  style={[styles.primaryButton, submittingWorkRequest && styles.buttonDisabled]}
                >
                  {submittingWorkRequest ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>신청 등록</Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.workRequestSection}>
                <View style={styles.workRequestListHeader}>
                  <Text style={styles.workRequestSectionTitle}>내 신청 목록</Text>
                  <Pressable onPress={loadMyWorkRequests}>
                    <Text style={styles.workRequestRefresh}>새로고침</Text>
                  </Pressable>
                </View>

                {loadingWorkRequests ? (
                  <ActivityIndicator color="#1463ff" />
                ) : workRequests.length === 0 ? (
                  <Text style={styles.workRequestEmpty}>등록된 신청이 없습니다.</Text>
                ) : (
                  workRequests.map((request) => (
                    <View key={request.id} style={styles.workRequestCard}>
                      <View style={styles.workRequestCardHeader}>
                        <Text style={styles.workRequestCardTitle}>{request.requestTypeLabel}</Text>
                        <Text style={styles.workRequestStatus}>{request.statusLabel}</Text>
                      </View>
                      <Text style={styles.workRequestCardMeta}>
                        {request.requestDate}
                        {request.halfDayTypeLabel ? ` · ${request.halfDayTypeLabel}` : ""}
                        {getWorkRequestDetailText(request) ? ` · ${getWorkRequestDetailText(request)}` : ""}
                      </Text>
                      <Text style={styles.workRequestCardReason}>{request.reason || "사유 없음"}</Text>
                      <Text style={styles.workRequestCardMeta}>등록 {formatDateTime(request.createdAt)}</Text>
                      {request.reviewedByName ? (
                        <Text style={styles.workRequestCardMeta}>
                          검토 {request.reviewedByName} · {formatDateTime(request.reviewedAt)}
                        </Text>
                      ) : null}
                      {request.cancelable ? (
                        <Pressable onPress={() => handleCancelWorkRequest(request.id)} style={styles.workRequestCancelButton}>
                          <Text style={styles.workRequestCancelButtonText}>신청 취소</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={showVacationInfoModal}
        onRequestClose={() => setShowVacationInfoModal(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.sheetTitle}>내 휴가 정보</Text>
                <Text style={styles.sheetDescription}>
                  휴가, 반차, 경조사, 유연근무 신청 내역을 월별 달력으로 확인할 수 있습니다.
                </Text>
              </View>
              <Pressable onPress={() => setShowVacationInfoModal(false)} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseButtonText}>닫기</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.workRequestScroll} contentContainerStyle={styles.workRequestScrollContent}>
              <View style={styles.vacationUsageSummaryCard}>
                <Text style={styles.vacationUsageSummaryTitle}>내가 사용한 휴가</Text>
                <View style={styles.vacationUsageSummaryRow}>
                  <View style={styles.vacationUsageSummaryItem}>
                    <Text style={styles.vacationUsageSummaryLabel}>연차사용</Text>
                    <Text style={styles.vacationUsageSummaryValue}>
                      {formatVacationDays(vacationUsageSummary.annualLeaveDays)}
                    </Text>
                    <Text style={styles.vacationUsageSummaryMeta}>일반휴가 + 반차</Text>
                  </View>
                  <View style={styles.vacationUsageSummaryItem}>
                    <Text style={styles.vacationUsageSummaryLabel}>기타</Text>
                    <Text style={styles.vacationUsageSummaryValue}>
                      {formatVacationDays(vacationUsageSummary.otherLeaveDays)}
                    </Text>
                    <Text style={styles.vacationUsageSummaryMeta}>경조사</Text>
                  </View>
                </View>
              </View>

              <View style={styles.vacationCalendarHeader}>
                <Pressable onPress={() => moveVacationCalendarMonth(-1)} style={styles.calendarMoveButton}>
                  <Text style={styles.calendarMoveButtonText}>이전</Text>
                </Pressable>
                <Text style={styles.vacationCalendarTitle}>{vacationCalendarData.title}</Text>
                <Pressable onPress={() => moveVacationCalendarMonth(1)} style={styles.calendarMoveButton}>
                  <Text style={styles.calendarMoveButtonText}>다음</Text>
                </Pressable>
              </View>
              <View style={styles.vacationCalendarWeekdays}>
                {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
                  <Text key={label} style={styles.vacationCalendarWeekday}>{label}</Text>
                ))}
              </View>
              <View style={styles.vacationCalendarGrid}>
                {vacationCalendarData.weeks.map((week, weekIndex) => (
                  <View key={`week-${weekIndex}`} style={styles.vacationCalendarWeek}>
                    {week.map((day) => (
                      <Pressable
                        key={day.dateKey}
                        onPress={() => setSelectedVacationDate(day.dateKey)}
                        style={[
                          styles.vacationCalendarDay,
                          !day.inMonth && styles.vacationCalendarDayMuted,
                          day.today && styles.vacationCalendarDayToday,
                          day.selected && styles.vacationCalendarDaySelected,
                        ]}
                      >
                        <Text style={[
                          styles.vacationCalendarDayText,
                          day.selected && styles.vacationCalendarDayTextSelected,
                        ]}>
                          {day.day}
                        </Text>
                        {day.requests.length ? (
                          <View style={styles.vacationCalendarBadgeRow}>
                            <Text style={styles.vacationCalendarBadge}>{day.requests.length}건</Text>
                            {day.pendingCount ? (
                              <Text style={styles.vacationCalendarPendingBadge}>대기</Text>
                            ) : null}
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>

              <View style={styles.workRequestSection}>
                <View style={styles.workRequestListHeader}>
                  <Text style={styles.workRequestSectionTitle}>{selectedVacationDate} 상세</Text>
                  <Pressable onPress={loadMyWorkRequests}>
                    <Text style={styles.workRequestRefresh}>새로고침</Text>
                  </Pressable>
                </View>
                {loadingWorkRequests ? (
                  <ActivityIndicator color="#1463ff" />
                ) : vacationCalendarData.selectedRequests.length === 0 ? (
                  <Text style={styles.workRequestEmpty}>선택한 날짜의 휴가 정보가 없습니다.</Text>
                ) : (
                  vacationCalendarData.selectedRequests.map((request) => (
                    <View key={`vacation-${request.id}`} style={styles.workRequestCard}>
                      <View style={styles.workRequestCardHeader}>
                        <Text style={styles.workRequestCardTitle}>{request.requestTypeLabel || getWorkRequestTypeLabel(request.requestType)}</Text>
                        <Text style={styles.workRequestStatus}>{request.statusLabel}</Text>
                      </View>
                      <Text style={styles.workRequestCardMeta}>
                        {getWorkRequestDetailText(request) || "종일"}
                      </Text>
                      <Text style={styles.workRequestCardReason}>{request.reason || "사유 없음"}</Text>
                      <Text style={styles.workRequestCardMeta}>등록 {formatDateTime(request.createdAt)}</Text>
                      {request.reviewedByName ? (
                        <Text style={styles.workRequestCardMeta}>
                          검토 {request.reviewedByName} · {formatDateTime(request.reviewedAt)}
                        </Text>
                      ) : null}
                      {request.cancelable ? (
                        <Pressable onPress={() => handleCancelWorkRequest(request.id)} style={styles.workRequestCancelButton}>
                          <Text style={styles.workRequestCancelButtonText}>신청 취소</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </View>
        </View>
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
      <Modal
        animationType="slide"
        transparent
        visible={showNoticeModal}
        onRequestClose={handleCloseNoticeModal}
      >
        <View style={[styles.sheetBackdrop, styles.noticeModalBackdrop]}>
          <View style={styles.noticeModalCard}>
            <View style={styles.noticeModalAccent} />
            <View style={styles.noticeModalHeader}>
              <View>
                <Text style={styles.noticeModalEyebrow}>NOTICE</Text>
                <Text style={styles.noticeModalTitle}>공지사항</Text>
              </View>
              <Pressable onPress={handleCloseNoticeModal} style={styles.noticeModalCloseButton}>
                <Text style={styles.noticeModalCloseButtonText}>확인</Text>
              </Pressable>
            </View>

            {noticeBlocks.length > 0 ? (
              <ScrollView
                style={styles.noticeModalScroll}
                contentContainerStyle={styles.noticeSheetContent}
                showsVerticalScrollIndicator
              >
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
              </ScrollView>
            ) : (
              <Text style={[styles.panelDescription, themeStyles.panelDescription]}>
                등록된 공지사항이 없습니다.
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
      <View style={styles.mapFirstShell}>
        {showCelebrationPhoto && activeCelebrationPhoto ? (
          <Pressable
            onPress={() => setShowCelebrationPhoto(false)}
            style={[styles.celebrationPhotoWrap, styles.map]}
          >
            <Image
              source={{ uri: activeCelebrationPhoto.dataUrl }}
              style={styles.celebrationPhotoBackground}
            />
            <View style={styles.celebrationPhotoBackdrop} />
            <View style={styles.celebrationPhotoInner}>
              <Image
                resizeMode="cover"
                source={{ uri: activeCelebrationPhoto.dataUrl }}
                style={styles.celebrationPhoto}
              />
            </View>
            <View style={styles.celebrationPhotoScrim} />
            <View style={styles.celebrationPhotoCaption}>
              <Text style={styles.celebrationPhotoCaptionEyebrow}>오늘의 랜덤 이미지</Text>
              <Text style={styles.celebrationPhotoCaptionTitle}>출근 완료를 축하해요</Text>
              <Text style={styles.celebrationPhotoCaptionHint}>이미지를 터치하면 지도로 돌아갑니다.</Text>
            </View>
          </Pressable>
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
            recenterRequest={mapRecenterRequest}
            style={styles.map}
          />
        )}

        <Pressable onPress={() => setShowMenu(true)} style={styles.topMenuButton}>
          <View style={styles.topMenuBar} />
          <View style={styles.topMenuBar} />
          <View style={styles.topMenuBar} />
        </Pressable>
        <View style={[styles.mapDistancePill, mapDistanceResponsiveStyle]}>
          <Pressable
            disabled={!currentLocation}
            onPress={() => setMapRecenterRequest((value) => value + 1)}
            style={styles.mapDistanceIconButton}
          >
            <Text style={styles.mapDistanceIcon}>⌖</Text>
          </Pressable>
          <Text style={styles.mapDistanceText}>
            {DEMO_MODE
              ? distance == null
                ? "DEMO"
                : `현재 거리 ${Math.round(distance)}m`
              : distance == null
                ? "위치 확인 중"
                : `현재 거리 ${Math.round(distance)}m`}
          </Text>
        </View>

        <View
          style={[styles.bottomLayerStack, bottomLayerResponsiveStyle]}
          onLayout={(event) => setBottomLayerHeight(event.nativeEvent.layout.height)}
        >
          <View style={[styles.mapFloatingControls, themeStyles.floatingCard]}>
            <View style={styles.floatingUserRow}>
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>{auth.user.name?.slice(0, 1) || "사"}</Text>
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.welcomeText, themeStyles.headerText]}>
                  {auth.user.name} <Text style={[styles.welcomeCode, themeStyles.welcomeCode]}>({auth.user.employeeCode})</Text>
                </Text>
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

            <View style={styles.actionRow}>
              <Pressable
                disabled={!canCheckIn}
                onPress={handleCheckIn}
                style={[styles.checkInButton, styles.actionButton, !canCheckIn && styles.buttonDisabled]}
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
                style={[styles.secondaryButton, styles.actionButton, !canCheckOut && styles.buttonDisabled]}
              >
                {submittingAttendance && attendance.checkedInAt && !attendance.checkedOutAt ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.secondaryButtonText}>퇴근하기</Text>
                )}
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => setShowNoticeModal(true)}
            style={styles.noticeDetailButton}
          >
            <View style={styles.noticeDetailLeft}>
              <Text style={styles.noticeDetailTitle}>공지사항</Text>
            </View>
            <View style={styles.noticeDetailRight}>
              <Text style={styles.noticeDetailArrow}>상세보기</Text>
              <Text style={styles.noticeChevron}>›</Text>
            </View>
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
    marginBottom: 6,
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
    backgroundColor: "#eef3fb",
    justifyContent: "flex-start",
  },
  sheetCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  sheetHandle: {
    display: "none",
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
  workRequestScroll: {
    marginHorizontal: -4,
  },
  workRequestScrollContent: {
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  workRequestNoticeCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  workRequestNoticeTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  workRequestNoticeText: {
    color: "#64748b",
    fontSize: 13,
    lineHeight: 20,
  },
  workRequestSection: {
    marginBottom: 18,
  },
  workRequestSectionTitle: {
    color: "#172033",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },
  requestTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  requestTypeChip: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  requestTypeChipActive: {
    backgroundColor: "#1463ff",
  },
  requestTypeChipText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
  requestTypeChipTextActive: {
    color: "#ffffff",
  },
  flexibleWorkStepperCard: {
    backgroundColor: "#f8fafc",
    borderColor: "#e5edf7",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  flexibleWorkStepperLabel: {
    color: "#172033",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },
  flexibleWorkStepperRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  flexibleWorkStepButton: {
    alignItems: "center",
    backgroundColor: "#1463ff",
    borderRadius: 16,
    height: 48,
    justifyContent: "center",
    width: 52,
  },
  flexibleWorkStepButtonText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 28,
  },
  flexibleWorkValueBox: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#dbe4f0",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
  },
  flexibleWorkValueText: {
    color: "#172033",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 2,
  },
  flexibleWorkValueMeta: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },
  flexibleWorkHelpText: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  workRequestDatePickerCard: {
    backgroundColor: "#f8fafc",
    borderColor: "#e5edf7",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  workRequestDatePickerHeader: {
    gap: 12,
    marginBottom: 12,
  },
  workRequestDatePickerLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  workRequestDatePickerSelected: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "900",
  },
  workRequestDatePickerNav: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  workRequestDatePickerMonth: {
    color: "#172033",
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  workRequestDatePickerGrid: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 6,
  },
  workRequestDatePickerDay: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    padding: 6,
    margin: 2,
    backgroundColor: "#ffffff",
    borderColor: "#edf2f7",
    borderWidth: 1,
  },
  workRequestInput: {
    marginBottom: 12,
  },
  workRequestReasonInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  workRequestListHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  workRequestRefresh: {
    color: "#1463ff",
    fontSize: 13,
    fontWeight: "800",
  },
  workRequestEmpty: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 21,
  },
  workRequestCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  workRequestCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 6,
  },
  workRequestCardTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "800",
  },
  workRequestStatus: {
    color: "#1463ff",
    fontSize: 13,
    fontWeight: "800",
  },
  workRequestCardMeta: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  workRequestCardReason: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  workRequestCancelButton: {
    alignSelf: "flex-start",
    backgroundColor: "#eef2ff",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 6,
  },
  workRequestCancelButtonText: {
    color: "#4338ca",
    fontSize: 13,
    fontWeight: "800",
  },
  vacationUsageSummaryCard: {
    backgroundColor: "#eef6ff",
    borderColor: "#dbeafe",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  vacationUsageSummaryTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 12,
  },
  vacationUsageSummaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  vacationUsageSummaryItem: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  vacationUsageSummaryLabel: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
  },
  vacationUsageSummaryValue: {
    color: "#1463ff",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 3,
  },
  vacationUsageSummaryMeta: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
  },
  vacationCalendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  vacationCalendarTitle: {
    color: "#172033",
    fontSize: 17,
    fontWeight: "900",
  },
  calendarMoveButton: {
    backgroundColor: "#edf1f7",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  calendarMoveButtonText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "800",
  },
  vacationCalendarWeekdays: {
    flexDirection: "row",
    marginBottom: 6,
  },
  vacationCalendarWeekday: {
    flex: 1,
    color: "#64748b",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  vacationCalendarGrid: {
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    padding: 8,
    marginBottom: 18,
  },
  vacationCalendarWeek: {
    flexDirection: "row",
  },
  vacationCalendarDay: {
    flex: 1,
    minHeight: 58,
    borderRadius: 12,
    padding: 6,
    margin: 2,
    backgroundColor: "#ffffff",
    borderColor: "#edf2f7",
    borderWidth: 1,
  },
  vacationCalendarDayMuted: {
    opacity: 0.42,
  },
  vacationCalendarDayToday: {
    borderColor: "#1463ff",
  },
  vacationCalendarDaySelected: {
    backgroundColor: "#1463ff",
    borderColor: "#1463ff",
  },
  vacationCalendarDayText: {
    color: "#172033",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 4,
  },
  vacationCalendarDayTextSelected: {
    color: "#ffffff",
  },
  vacationCalendarBadgeRow: {
    gap: 3,
  },
  vacationCalendarBadge: {
    alignSelf: "flex-start",
    color: "#1463ff",
    fontSize: 10,
    fontWeight: "900",
  },
  vacationCalendarPendingBadge: {
    alignSelf: "flex-start",
    color: "#f97316",
    fontSize: 10,
    fontWeight: "900",
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
  mapFirstShell: {
    flex: 1,
    backgroundColor: "#eef3fb",
    position: "relative",
  },
  minimalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 2,
    paddingBottom: 12,
  },
  mapHeroStack: {
    flex: 1,
    minHeight: 360,
    position: "relative",
  },
  topMenuButton: {
    position: "absolute",
    right: 18,
    top: 18,
    zIndex: 8,
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.72)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  topMenuBar: {
    width: 18,
    height: 2,
    borderRadius: 999,
    backgroundColor: "#172033",
    marginVertical: 2,
  },
  mapDistancePill: {
    position: "absolute",
    left: 22,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.09,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  mapDistanceIcon: {
    color: "#0f9d94",
    fontSize: 13,
    fontWeight: "900",
  },
  mapDistanceIconButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 22,
    minWidth: 22,
  },
  mapDistanceText: {
    color: "#172033",
    fontSize: 13,
    fontWeight: "800",
  },
  floatingHeaderCard: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    zIndex: 5,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderColor: "#e4ebf5",
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.13,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  workplaceTitle: {
    color: "#1463ff",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4,
  },
  welcomeText: {
    color: "#172033",
    fontSize: 17,
    fontWeight: "800",
  },
  welcomeCode: {
    color: "#52607a",
    fontSize: 15,
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
    gap: 8,
  },
  menuButton: {
    borderRadius: 14,
    backgroundColor: "#172033",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    paddingVertical: 9,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  menuButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
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
    overflow: "hidden",
    backgroundColor: "#dfe7f4",
  },
  map: {
    flex: 1,
  },
  celebrationPhotoWrap: {
    flex: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  celebrationPhotoBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.38,
  },
  celebrationPhoto: {
    width: "100%",
    height: "100%",
  },
  celebrationPhotoBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.22)",
  },
  celebrationPhotoInner: {
    width: "100%",
    height: "100%",
  },
  celebrationPhotoScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.24)",
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
    left: 18,
    right: 18,
    bottom: 160,
    zIndex: 20,
    backgroundColor: "rgba(15,23,42,0.76)",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
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
  celebrationPhotoCaptionHint: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 6,
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
    paddingTop: 10,
    paddingBottom: 8,
  },
  mapFloatingControls: {
    backgroundColor: "#ffffff",
    borderColor: "rgba(226,232,240,0.96)",
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.20,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },
  bottomLayerStack: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    zIndex: 5,
    gap: 10,
  },
  floatingUserRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#67d5ca",
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "900",
  },
  noticeDetailButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "rgba(226,232,240,0.95)",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: "#0f172a",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 8,
  },
  noticeDetailLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  noticeDetailTitle: {
    color: "#172033",
    fontSize: 16,
    fontWeight: "800",
  },
  noticeDetailRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noticeDetailArrow: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "800",
  },
  noticeChevron: {
    color: "#94a3b8",
    fontSize: 24,
    fontWeight: "700",
  },
  noticePanelCard: {
    backgroundColor: "#ffffff",
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#e4ebf5",
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  floatingBottomCard: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 5,
    backgroundColor: "#ffffff",
    borderColor: "#e4ebf5",
    borderRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
  attendanceSummaryRow: {
    flexDirection: "row",
    gap: 0,
    marginBottom: 14,
  },
  attendanceSummaryCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 0,
    alignItems: "center",
  },
  attendanceSummaryLabel: {
    color: "#6a7487",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  attendanceSummaryValue: {
    color: "#172033",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  panelTitle: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
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
    paddingVertical: 7,
    marginBottom: 8,
  },
  noticeToggleButtonText: {
    color: "#1463ff",
    fontSize: 13,
    fontWeight: "800",
  },
  panelDescription: {
    color: "#59657a",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  noticeViewport: {
    overflow: "hidden",
    marginBottom: 8,
    borderRadius: 14,
  },
  noticeContent: {
    gap: 8,
    minHeight: 38,
  },
  noticeSheetCard: {
    maxHeight: "72%",
  },
  noticeModalBackdrop: {
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  noticeModalCard: {
    width: "100%",
    maxWidth: 430,
    maxHeight: "72%",
    backgroundColor: "#ffffff",
    borderColor: "rgba(226,232,240,0.96)",
    borderRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    shadowColor: "#0f172a",
    shadowOpacity: 0.22,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  noticeModalAccent: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#14b8a6",
    marginBottom: 14,
  },
  noticeModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  noticeModalEyebrow: {
    color: "#14b8a6",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
    marginBottom: 3,
  },
  noticeModalTitle: {
    color: "#10213a",
    fontSize: 23,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  noticeModalCloseButton: {
    backgroundColor: "#172033",
    borderRadius: 999,
    paddingHorizontal: 17,
    paddingVertical: 10,
  },
  noticeModalCloseButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  noticeModalScroll: {
    borderRadius: 20,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noticeSheetContent: {
    gap: 8,
    paddingBottom: 4,
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
    fontSize: 14,
    lineHeight: 20,
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
    backgroundColor: "#49b85a",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 58,
    shadowColor: "#15803d",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  checkInButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#ff762b",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 58,
    shadowColor: "#c2410c",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    gap: 18,
    alignItems: "center",
    marginTop: 8,
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
