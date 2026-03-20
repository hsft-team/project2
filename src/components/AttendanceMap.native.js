import MapView, { Circle, Marker } from "react-native-maps";

export default function AttendanceMap({
  companyLocation,
  companyName,
  companyRadiusMeters,
  currentLocation,
  style,
}) {
  return (
    <MapView
      showsUserLocation
      style={style}
      initialRegion={companyLocation}
      region={
        currentLocation
          ? {
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
              latitudeDelta: 0.008,
              longitudeDelta: 0.008,
            }
          : companyLocation
      }
    >
      <Marker coordinate={companyLocation} title={companyName} />
      <Circle
        center={companyLocation}
        fillColor="rgba(20, 99, 255, 0.12)"
        radius={companyRadiusMeters}
        strokeColor="rgba(20, 99, 255, 0.45)"
        strokeWidth={2}
      />
    </MapView>
  );
}
