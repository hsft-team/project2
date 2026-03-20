import { StyleSheet, Text, View } from "react-native";

export default function AttendanceMap({
  companyLocation,
  companyName,
  companyRadiusMeters,
  currentLocation,
  style,
}) {
  return (
    <View style={[styles.wrapper, style]}>
      <View style={styles.card}>
        <Text style={styles.title}>웹 미리보기</Text>
        <Text style={styles.description}>
          Mac 브라우저에서는 지도를 단순화해서 보여줍니다. 실제 지도와 사용자 위치 표시는 iPhone의 Expo Go에서 확인할 수 있습니다.
        </Text>
        <Text style={styles.row}>회사: {companyName}</Text>
        <Text style={styles.row}>반경: {companyRadiusMeters}m</Text>
        <Text style={styles.row}>
          회사 좌표: {companyLocation.latitude.toFixed(6)}, {companyLocation.longitude.toFixed(6)}
        </Text>
        <Text style={styles.row}>
          현재 좌표: {currentLocation ? `${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)}` : "위치 확인 전"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    backgroundColor: "#dfe7f4",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    maxWidth: 520,
    padding: 24,
    width: "100%",
  },
  title: {
    color: "#172033",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  description: {
    color: "#5b667a",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  row: {
    color: "#23304a",
    fontSize: 14,
    marginBottom: 8,
  },
});
