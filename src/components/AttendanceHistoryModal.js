import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getAttendanceHistory } from "../services/api";

function seoulDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftMonth(month, offset) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function timeLabel(value) {
  if (!value) return "미기록";
  // Backend LocalDateTime values already represent Seoul time.
  return value.slice(11, 16);
}

export default function AttendanceHistoryModal({ token, onClose }) {
  const today = seoulDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    getAttendanceHistory({ token, month, signal: controller.signal })
      .then((records) => { if (active) setResult({ month, records }); })
      .catch((reason) => { if (active) setError(reason.message || "출근 기록을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, month, retry]);

  const records = result?.month === month ? result.records : [];
  const ready = !loading && result?.month === month && !error;
  const recordsByDate = new Map(records.map((record) => [record.attendanceDate, record]));
  const selected = recordsByDate.get(selectedDate);
  const [year, monthNumber] = month.split("-").map(Number);
  const offset = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const cellCount = Math.ceil((offset + days) / 7) * 7;

  function moveMonth(direction) {
    const nextMonth = shiftMonth(month, direction);
    setMonth(nextMonth);
    setSelectedDate(nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`);
    setLoading(true);
    setError("");
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>나의 출근 기록</Text>
              <Text style={styles.description}>날짜를 눌러 출퇴근 시간을 확인하세요.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="출근 기록 닫기" onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.monthRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="이전 달" onPress={() => moveMonth(-1)} style={styles.arrow}>
                <Text style={styles.arrowText}>‹</Text>
              </Pressable>
              <Text style={styles.month}>{year}년 {monthNumber}월</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="다음 달" disabled={month >= today.slice(0, 7)} onPress={() => moveMonth(1)} style={[styles.arrow, month >= today.slice(0, 7) && styles.disabled]}>
                <Text style={styles.arrowText}>›</Text>
              </Pressable>
            </View>
            <View style={styles.weekdays}>
              {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
                <Text key={day} style={[styles.weekday, index === 0 && styles.sunday]}>{day}</Text>
              ))}
            </View>
            <View style={styles.grid}>
              {Array.from({ length: cellCount }, (_, index) => {
                const day = index - offset + 1;
                if (day < 1 || day > days) return <View key={`blank-${index}`} style={styles.cell} />;
                const date = `${month}-${String(day).padStart(2, "0")}`;
                const record = ready ? recordsByDate.get(date) : null;
                return (
                  <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: selectedDate === date }} accessibilityLabel={`${date}${record ? record.late ? ", 지각 출근" : ", 출근" : ""}`} onPress={() => setSelectedDate(date)} style={styles.cell}>
                    <View style={[styles.dayCircle, date === today && styles.today, date === selectedDate && styles.selected]}>
                      <Text style={[styles.dayText, index % 7 === 0 && styles.sunday, date === selectedDate && styles.selectedText]}>{day}</Text>
                    </View>
                    <View style={styles.markerSpace}>
                      {record ? <View style={[styles.dot, record.late && styles.lateDot]} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.legend}>
              <View style={styles.dot} /><Text style={styles.legendText}>출근</Text>
              <View style={[styles.dot, styles.lateDot]} /><Text style={styles.legendText}>지각</Text>
              <Text style={styles.todayHint}>테두리: 오늘</Text>
            </View>
            {loading ? (
              <View style={styles.state}><ActivityIndicator color="#1463ff" /><Text style={styles.description}>출근 기록을 불러오는 중입니다.</Text></View>
            ) : error ? (
              <View style={styles.state}>
                <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.close}><Text style={styles.closeText}>다시 시도</Text></Pressable>
              </View>
            ) : ready ? (
              <>
                <Text style={styles.summary}>이번 달 출근 {records.length}일 · 지각 {records.filter((record) => record.late).length}일</Text>
                <View style={styles.detail}>
                  <Text style={styles.detailDate}>{Number(selectedDate.slice(5, 7))}월 {Number(selectedDate.slice(8))}일</Text>
                  {selected ? (
                    <>
                      <Text style={[styles.status, selected.late && styles.lateText]}>{selected.late ? "지각 출근" : "출근 완료"}{selected.checkedOutAt ? " · 퇴근 완료" : " · 퇴근 미기록"}</Text>
                      <View style={styles.times}>
                        <View style={styles.timeItem}><Text style={styles.description}>출근</Text><Text style={styles.time}>{timeLabel(selected.checkedInAt)}</Text></View>
                        <View style={styles.timeItem}><Text style={styles.description}>퇴근</Text><Text style={styles.time}>{timeLabel(selected.checkedOutAt)}</Text></View>
                      </View>
                    </>
                  ) : <Text style={styles.description}>등록된 출근 기록이 없습니다.</Text>}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.42)" },
  sheet: { maxHeight: "90%", backgroundColor: "#fff", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16 },
  headerCopy: { flex: 1 },
  title: { color: "#172033", fontSize: 21, fontWeight: "800" },
  description: { color: "#64748b", fontSize: 12, lineHeight: 19, marginTop: 4 },
  close: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 22, backgroundColor: "#edf3ff" },
  closeText: { color: "#1463ff", fontSize: 13, fontWeight: "700" },
  content: { paddingBottom: 18 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  month: { color: "#172033", fontSize: 19, fontWeight: "800" },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#f4f7fb" },
  arrowText: { fontSize: 27, color: "#334155" },
  disabled: { opacity: 0.25 },
  weekdays: { flexDirection: "row", marginBottom: 6 },
  weekday: { width: "14.285714%", textAlign: "center", color: "#64748b", fontSize: 12, paddingVertical: 6 },
  sunday: { color: "#dc5461" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.285714%", height: 52, alignItems: "center", justifyContent: "center" },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  today: { borderColor: "#1463ff" },
  selected: { backgroundColor: "#1463ff" },
  dayText: { fontSize: 14, color: "#334155" },
  selectedText: { color: "#fff", fontWeight: "800" },
  markerSpace: { height: 10, justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#1463ff" },
  lateDot: { backgroundColor: "#e18a18" },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  legendText: { color: "#64748b", fontSize: 12, marginRight: 10 },
  todayHint: { color: "#94a3b8", fontSize: 11, marginLeft: "auto" },
  state: { paddingVertical: 22, alignItems: "center", gap: 12 },
  error: { color: "#be123c", fontSize: 13, lineHeight: 20 },
  summary: { color: "#475569", fontSize: 13, marginVertical: 16 },
  detail: { backgroundColor: "#f4f7fb", borderRadius: 18, padding: 16 },
  detailDate: { color: "#172033", fontSize: 16, fontWeight: "800" },
  status: { color: "#1463ff", fontSize: 12, marginTop: 8 },
  lateText: { color: "#a65e08" },
  times: { flexDirection: "row", marginTop: 10 },
  timeItem: { flex: 1 },
  time: { color: "#172033", fontSize: 23, fontWeight: "800", marginTop: 4 },
});
