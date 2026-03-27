import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import L from "leaflet";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
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
    <div style="position:relative;width:34px;height:42px;">
      <div style="position:absolute;left:5px;top:2px;width:22px;height:28px;border-radius:7px;background:linear-gradient(135deg,#2a2f3a 0%,#0f172a 100%);box-shadow:0 8px 14px rgba(15,23,42,.22);"></div>
      <div style="position:absolute;left:8px;top:6px;width:16px;height:4px;border-radius:999px;background:rgba(226,232,240,.9);"></div>
      <div style="position:absolute;left:9px;top:13px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:15px;top:13px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:21px;top:13px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:9px;top:20px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:15px;top:20px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:21px;top:20px;width:4px;height:4px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:13px;bottom:3px;width:6px;height:8px;border-radius:3px 3px 0 0;background:#cbd5e1;"></div>
    </div>
  `,
  iconSize: [34, 42],
  iconAnchor: [17, 34],
});

const currentLocationIcon = new L.DivIcon({
  className: "current-location-marker",
  html: `
    <div style="position:relative;width:34px;height:40px;">
      <div style="position:absolute;left:3px;top:8px;width:28px;height:28px;border-radius:999px;background:rgba(77,159,255,.12);"></div>
      <div style="position:absolute;left:10px;top:3px;width:11px;height:11px;border-radius:999px;background:#ffffff;border:3px solid #1677ff;box-sizing:border-box;"></div>
      <div style="position:absolute;left:8px;top:15px;width:16px;height:13px;border-radius:10px 10px 7px 7px;background:#ffffff;border:3px solid #1677ff;box-sizing:border-box;"></div>
    </div>
  `,
  iconSize: [34, 40],
  iconAnchor: [17, 20],
});

const currentLocationDotIcon = new L.DivIcon({
  className: "current-location-dot-marker",
  html: `
    <div style="position:relative;width:24px;height:24px;">
      <div style="position:absolute;inset:0;border-radius:999px;background:rgba(77,159,255,.18);"></div>
      <div style="position:absolute;left:4px;top:4px;width:16px;height:16px;border-radius:999px;background:rgba(77,159,255,.24);"></div>
      <div style="position:absolute;left:7px;top:7px;width:10px;height:10px;border-radius:999px;background:#1677ff;border:3px solid #ffffff;box-sizing:border-box;"></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function MapViewport({ companyLocation, currentLocation }) {
  const map = useMap();

  useEffect(() => {
    if (currentLocation) {
      map.setView([currentLocation.latitude, currentLocation.longitude], 15);
      return;
    }

    map.setView([companyLocation.latitude, companyLocation.longitude], 15);
  }, [companyLocation.latitude, companyLocation.longitude, currentLocation, map]);

  return null;
}

export default function AttendanceMap({
  companyLocation,
  companyName,
  companyRadiusMeters,
  currentLocation,
  style,
}) {
  const distanceToCompany = currentLocation
    ? getDistanceInMeters(currentLocation, companyLocation)
    : null;
  const shouldUseCompactCurrentLocation =
    currentLocation &&
    distanceToCompany < 40;
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
        <MapViewport companyLocation={companyLocation} currentLocation={currentLocation} />
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
        {currentLocation ? (
          <Marker
            icon={shouldUseCompactCurrentLocation ? currentLocationDotIcon : currentLocationIcon}
            position={[currentLocation.latitude, currentLocation.longitude]}
          >
            <Popup>현재 위치</Popup>
          </Marker>
        ) : null}
      </MapContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: "#dfe7f4",
    padding: 16,
  },
  map: {
    borderRadius: 24,
    height: "100%",
    overflow: "hidden",
    width: "100%",
    zIndex: 1,
  },
});
