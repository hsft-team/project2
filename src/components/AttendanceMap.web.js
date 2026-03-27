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

const currentLocationDotIcon = new L.DivIcon({
  className: "current-location-dot-marker",
  html: `
    <div style="position:relative;width:24px;height:24px;">
      <div style="position:absolute;inset:0;border-radius:999px;background:rgba(20,99,255,.18);"></div>
      <div style="position:absolute;left:4px;top:4px;width:16px;height:16px;border-radius:999px;background:rgba(20,99,255,.24);"></div>
      <div style="position:absolute;left:7px;top:7px;width:10px;height:10px;border-radius:999px;background:#1463ff;border:3px solid #ffffff;box-sizing:border-box;"></div>
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

function offsetCoordinate({ latitude, longitude }, northMeters, eastMeters) {
  const latitudeOffset = northMeters / 111320;
  const longitudeOffset =
    eastMeters / (111320 * Math.cos((latitude * Math.PI) / 180));

  return {
    latitude: latitude + latitudeOffset,
    longitude: longitude + longitudeOffset,
  };
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
  const displayedCurrentLocation =
    currentLocation && shouldUseCompactCurrentLocation
      ? offsetCoordinate(currentLocation, 8, 12)
      : currentLocation;
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
          zIndexOffset={100}
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
            position={[displayedCurrentLocation.latitude, displayedCurrentLocation.longitude]}
            zIndexOffset={1000}
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
