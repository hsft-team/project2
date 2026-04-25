import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import L from "leaflet";
import { Circle, MapContainer, Marker, Pane, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { getDistanceInMeters } from "../utils/location";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const companyIcon = new L.DivIcon({
  className: "company-marker",
  html: `
    <div style="position:relative;width:34px;height:34px;">
      <div style="position:absolute;inset:0;border-radius:999px;background:#1f2937;box-shadow:0 10px 18px rgba(15,23,42,.24);"></div>
      <div style="position:absolute;left:9px;top:9px;width:16px;height:16px;border-radius:4px;background:#e5edf7;"></div>
      <div style="position:absolute;left:11px;top:11px;width:12px;height:3px;border-radius:999px;background:#94a3b8;"></div>
      <div style="position:absolute;left:11px;top:16px;width:3px;height:3px;border-radius:1px;background:#64748b;"></div>
      <div style="position:absolute;left:16px;top:16px;width:3px;height:3px;border-radius:1px;background:#64748b;"></div>
      <div style="position:absolute;left:21px;top:16px;width:3px;height:3px;border-radius:1px;background:#64748b;"></div>
      <div style="position:absolute;left:15px;top:21px;width:4px;height:4px;border-radius:1px;background:#64748b;"></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const currentLocationIcon = new L.DivIcon({
  className: "current-location-marker",
  html: `
    <div style="position:relative;width:34px;height:34px;">
      <div style="position:absolute;inset:0;border-radius:999px;background:#1463ff;box-shadow:0 10px 18px rgba(20,99,255,.28);"></div>
      <div style="position:absolute;left:12px;top:8px;width:10px;height:10px;border-radius:999px;background:#f8fafc;"></div>
      <div style="position:absolute;left:9px;top:18px;width:16px;height:9px;border-radius:9px 9px 6px 6px;background:#f8fafc;"></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function MapViewport({ companyLocation, currentLocation, recenterRequest }) {
  const map = useMap();

  useEffect(() => {
    if (currentLocation) {
      map.setView([currentLocation.latitude, currentLocation.longitude], 15);
      return;
    }

    map.setView([companyLocation.latitude, companyLocation.longitude], 15);
  }, [companyLocation.latitude, companyLocation.longitude, currentLocation, map, recenterRequest]);

  return null;
}

export default function AttendanceMap({
  companyLocation,
  companyName,
  companyRadiusMeters,
  currentLocation,
  recenterRequest = 0,
  style,
}) {
  const distanceToCompany = currentLocation
    ? getDistanceInMeters(currentLocation, companyLocation)
    : null;
  const isInsideCompanyRadius =
    distanceToCompany == null || distanceToCompany <= companyRadiusMeters;
  const circleColor = isInsideCompanyRadius
    ? "rgba(20, 99, 255, 0.55)"
    : "rgba(220, 38, 38, 0.75)";
  const circleFillColor = isInsideCompanyRadius
    ? "rgba(20, 99, 255, 0.12)"
    : "rgba(220, 38, 38, 0.10)";

  return (
    <View style={[styles.wrapper, style]}>
      <MapContainer
        center={[companyLocation.latitude, companyLocation.longitude]}
        scrollWheelZoom
        style={styles.map}
        zoom={15}
      >
        <MapViewport
          companyLocation={companyLocation}
          currentLocation={currentLocation}
          recenterRequest={recenterRequest}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Circle
          center={[companyLocation.latitude, companyLocation.longitude]}
          fillColor={circleFillColor}
          pathOptions={{ color: circleColor, weight: 2.5 }}
          radius={companyRadiusMeters}
        />
        <Pane name="company-location-pane" style={{ zIndex: 500 }}>
          <Marker
            icon={companyIcon}
            position={[companyLocation.latitude, companyLocation.longitude]}
          >
            <Popup>
              {companyName}
              <br />
              허용 반경 {companyRadiusMeters}m
            </Popup>
          </Marker>
        </Pane>
        {currentLocation ? (
          <Pane name="current-location-pane" style={{ zIndex: 700 }}>
            <Marker
              icon={currentLocationIcon}
              position={[currentLocation.latitude, currentLocation.longitude]}
            >
              <Popup>현재 위치</Popup>
            </Marker>
          </Pane>
        ) : null}
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "#dfe7f4",
  },
  map: {
    height: "100%",
    overflow: "hidden",
    width: "100%",
    zIndex: 1,
  },
});
