import axios from "axios";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "https://api.hsft.io.kr/api";
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === "true";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 5000,
});

function getErrorMessage(error, fallbackMessage) {
  return (
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage
  );
}

function normalizeLoginErrorMessage(error, employeeCode, password) {
  if (!employeeCode || !password) {
    return "사번과 비밀번호를 입력해 주세요.";
  }

  const status = error?.response?.status;
  const serverMessage = error?.response?.data?.message;
  const fallbackMessage = getErrorMessage(error, "로그인에 실패했습니다.");

  if (typeof serverMessage === "string" && serverMessage.includes("이미 다른 단말이 등록")) {
    return "이 계정은 다른 단말에 이미 등록되어 있습니다. 관리자에게 단말 초기화를 요청한 뒤 다시 로그인해 주세요.";
  }

  if (typeof serverMessage === "string" && serverMessage.includes("사번 또는 비밀번호")) {
    return "사번 또는 비밀번호가 올바르지 않습니다. 입력값을 다시 확인해 주세요.";
  }

  if (status === 401 && typeof serverMessage === "string" && serverMessage.trim()) {
    return serverMessage;
  }

  if (typeof status === "number" && status >= 500) {
    return "서버 오류로 로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  return fallbackMessage;
}

function getUserPayload(data, employeeCode) {
  return {
    id: data?.employeeId,
    name: data?.employeeName || "사용자",
    employeeCode,
    companyName: data?.companyName,
    role: data?.role,
    passwordChangeRequired: Boolean(data?.passwordChangeRequired),
  };
}

function normalizeTodayAttendance(data) {
  return {
    checkedIn: Boolean(data?.checkedIn),
    checkedInAt:
      data?.checkInTime ||
      null,
    checkedOutAt:
      data?.checkOutTime ||
      null,
    attendanceDate: data?.attendanceDate || null,
    status: data?.status || null,
    companyName: data?.companyName || null,
  };
}

function normalizeCompanySetting(data) {
  if (!data) {
    return null;
  }

  return {
    companyId: data.companyId,
    companyName: data.companyName,
    latitude: data.latitude,
    longitude: data.longitude,
    allowedRadiusMeters: data.allowedRadiusMeters,
    lateAfterTime: data.lateAfterTime,
    noticeMessage: data.noticeMessage || "",
  };
}

export async function login({ employeeCode, password, deviceId, deviceName }) {
  if (DEMO_MODE) {
    if (!employeeCode || !password) {
      throw new Error("사번과 비밀번호를 입력해 주세요.");
    }

    return {
      token: "demo-token",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      user: {
        id: employeeCode,
        name: employeeCode === "ADMIN001" ? "관리자" : "홍길동",
        employeeCode,
        companyName: "OpenAI Seoul Office",
        role: employeeCode === "ADMIN001" ? "ADMIN" : "EMPLOYEE",
        passwordChangeRequired: false,
      },
    };
  }

  try {
    const response = await api.post("/auth/login", {
      employeeCode,
      password,
      deviceId,
      deviceName,
    });

    return {
      token: response.data?.accessToken,
      tokenType: response.data?.tokenType || "Bearer",
      expiresAt: response.data?.accessTokenExpiresAt,
      user: getUserPayload(response.data, employeeCode),
    };
  } catch (error) {
    throw new Error(normalizeLoginErrorMessage(error, employeeCode, password));
  }
}

export async function changePassword({ token, currentPassword, newPassword }) {
  if (DEMO_MODE) {
    return {
      message: "데모 모드에서 비밀번호가 변경되었습니다.",
    };
  }

  try {
    const response = await api.post(
      "/auth/change-password",
      { currentPassword, newPassword },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return {
      message: response.data?.message || "비밀번호가 변경되었습니다.",
    };
  } catch (error) {
    throw new Error(getErrorMessage(error, "비밀번호 변경에 실패했습니다."));
  }
}

export async function getTodayAttendance({ token }) {
  if (DEMO_MODE) {
    return normalizeTodayAttendance(null);
  }

  try {
    const response = await api.get("/attendance/today", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return normalizeTodayAttendance(response.data);
  } catch (error) {
    throw new Error(getErrorMessage(error, "오늘 출근 상태를 불러오지 못했습니다."));
  }
}

export async function getCompanySetting({ token }) {
  if (DEMO_MODE) {
    return normalizeCompanySetting({
      companyId: 1,
      companyName: "OpenAI Seoul Office",
      latitude: 37.5665,
      longitude: 126.978,
      allowedRadiusMeters: 100,
      lateAfterTime: "09:00:00",
    });
  }

  try {
    const response = await api.get("/attendance/company-setting", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return normalizeCompanySetting(response.data);
  } catch (error) {
    throw new Error(getErrorMessage(error, "회사 설정을 불러오지 못했습니다."));
  }
}

export async function getPublicCompanySetting() {
  if (DEMO_MODE) {
    return normalizeCompanySetting({
      companyId: 1,
      companyName: "OpenAI Seoul Office",
      latitude: 37.5665,
      longitude: 126.978,
      allowedRadiusMeters: 100,
      lateAfterTime: "09:00:00",
    });
  }

  try {
    const response = await api.get("/attendance/public/company-setting");
    return normalizeCompanySetting(response.data);
  } catch (error) {
    return null;
  }
}

export async function checkIn({ token, latitude, longitude, accuracyMeters, capturedAt }) {
  if (DEMO_MODE) {
    return {
      status: "checked-in",
      checkedInAt: new Date().toISOString(),
      late: false,
      message: "데모 모드에서 출근 처리되었습니다.",
    };
  }

  try {
    const response = await api.post(
      "/attendance/check-in",
      { latitude, longitude, accuracyMeters, capturedAt },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return {
      status: "checked-in",
      checkedInAt: response.data?.checkInTime || new Date().toISOString(),
      late: Boolean(response.data?.late),
      message: response.data?.message,
    };
  } catch (error) {
    throw new Error(getErrorMessage(error, "출근 처리에 실패했습니다."));
  }
}

export async function checkOut({ token, latitude, longitude, accuracyMeters, capturedAt }) {
  if (DEMO_MODE) {
    return {
      status: "checked-out",
      checkedOutAt: new Date().toISOString(),
      message: "데모 모드에서 퇴근 처리되었습니다.",
    };
  }

  try {
    const response = await api.post(
      "/attendance/check-out",
      { latitude, longitude, accuracyMeters, capturedAt },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return {
      status: "checked-out",
      checkedOutAt:
        response.data?.checkOutTime ||
        response.data?.checkedOutAt ||
        new Date().toISOString(),
      message: response.data?.message,
    };
  } catch (error) {
    throw new Error(getErrorMessage(error, "퇴근 처리에 실패했습니다."));
  }
}
