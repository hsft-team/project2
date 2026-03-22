import axios from "axios";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://api.hsft.io.kr/api";
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

function getUserPayload(data, employeeCode) {
  return {
    id: data?.employeeId,
    name: data?.employeeName || "사용자",
    employeeCode,
    companyName: data?.companyName,
    role: data?.role,
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
  };
}

export async function login({ employeeCode, password }) {
  if (DEMO_MODE) {
    if (!employeeCode || !password) {
      throw new Error("사번과 비밀번호를 입력해 주세요.");
    }

    return {
      token: "demo-token",
      tokenType: "Bearer",
      user: {
        id: employeeCode,
        name: employeeCode === "ADMIN001" ? "관리자" : "홍길동",
        employeeCode,
        companyName: "OpenAI Seoul Office",
        role: employeeCode === "ADMIN001" ? "ADMIN" : "EMPLOYEE",
      },
    };
  }

  try {
    const response = await api.post("/auth/login", { employeeCode, password });

    return {
      token: response.data?.accessToken,
      tokenType: response.data?.tokenType || "Bearer",
      user: getUserPayload(response.data, employeeCode),
    };
  } catch (error) {
    if (!employeeCode || !password) {
      throw new Error("사번과 비밀번호를 입력해 주세요.");
    }
    throw new Error(getErrorMessage(error, "로그인에 실패했습니다."));
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

export async function checkIn({ token, latitude, longitude }) {
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
      { latitude, longitude },
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

export async function checkOut({ token, latitude, longitude }) {
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
      { latitude, longitude },
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
