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
    <div style="position:relative;width:44px;height:56px;">
      <div style="position:absolute;left:8px;top:4px;width:28px;height:38px;border-radius:8px;background:linear-gradient(135deg,#2a2f3a 0%,#0f172a 100%);box-shadow:0 10px 18px rgba(15,23,42,.24);"></div>
      <div style="position:absolute;left:12px;top:9px;width:20px;height:5px;border-radius:999px;background:rgba(226,232,240,.92);"></div>
      <div style="position:absolute;left:13px;top:18px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:20px;top:18px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:27px;top:18px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:13px;top:27px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:20px;top:27px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:27px;top:27px;width:5px;height:5px;border-radius:2px;background:#cbd5e1;"></div>
      <div style="position:absolute;left:18px;bottom:6px;width:8px;height:11px;border-radius:3px 3px 0 0;background:#cbd5e1;"></div>
    </div>
  `,
  iconSize: [44, 56],
  iconAnchor: [22, 44],
});

const currentLocationIcon = new L.DivIcon({
  className: "current-location-marker",
  html: `
    <div style="position:relative;width:40px;height:46px;">
      <div style="position:absolute;left:2px;top:8px;width:36px;height:36px;border-radius:999px;background:rgba(77,159,255,.14);"></div>
      <div style="position:absolute;left:10px;top:2px;width:14px;height:14px;border-radius:999px;background:#ffffff;border:4px solid #1677ff;box-sizing:border-box;"></div>
      <div style="position:absolute;left:7px;top:16px;width:20px;height:16px;border-radius:10px 10px 8px 8px;background:#ffffff;border:4px solid #1677ff;box-sizing:border-box;"></div>
    </div>
  `,
  iconSize: [40, 46],
  iconAnchor: [20, 23],
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
  const shouldUseCompactCurrentLocation =
    currentLocation &&
    getDistanceInMeters(currentLocation, companyLocation) < 20;

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
          fillColor="rgba(20, 99, 255, 0.12)"
          pathOptions={{ color: "rgba(20, 99, 255, 0.55)", weight: 2 }}
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
