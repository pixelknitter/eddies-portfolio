import React, { useCallback, useEffect, useState, useMemo } from "react"
import { StyleSheet, Text, View, Animated, Pressable } from "react-native"
// import { StatusBar } from "expo-status-bar"

import Entypo from "@expo/vector-icons/Entypo"
import { SplashScreen, Stack, Link } from "expo-router"
import { ResizeMode, Video } from "expo-av"
import * as Font from "expo-font"
import { SafeAreaView } from "react-native-safe-area-context"
import { Layout } from "../styles/Layout"
import { Fonts } from "../styles/Fonts"
import { Colors } from "../styles/Colors"

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync()

// Some values to modify the styling of the app
const ROCKET_SIZE = 30

export default function App() {
  const opacity = useMemo(() => new Animated.Value(0), [])

  const onVideoLoad = () => {
    // https://facebook.github.io/react-native/docs/animated#timing
    Animated.timing(opacity, {
      toValue: 1,
      useNativeDriver: true,
    }).start()
  }

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: "Welcome" }} />
      <View style={styles.background}>
        <Animated.View
          style={[styles.backgroundViewWrapper, { opacity: opacity }]}
        >
          <Video
            isLooping
            isMuted
            positionMillis={500}
            onLoad={onVideoLoad}
            resizeMode={ResizeMode.STRETCH}
            shouldPlay
            source={require("../assets/videos/wireframe.mp4")}
            style={styles.video}
          />
        </Animated.View>
      </View>
      <View style={styles.overlay}>
        <Text style={styles.title}>Eddie's Portfolio Demo 👋</Text>
        <Link
          href="details"
          style={styles.link}
          // TODO: determine why the below are required to satisfy TypeScript
          accessibilityLabelledBy={undefined}
          accessibilityLanguage={undefined}
          asChild
        >
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Find Out More</Text>
            <Entypo name="rocket" size={ROCKET_SIZE} />
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "center",
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "black",
  },
  backgroundViewWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingHorizontal: Layout.Container,
  },
  video: { flex: 1 },
  title: {
    color: Colors.Accent,
    fontSize: ROCKET_SIZE,
    fontWeight: "bold",
    marginTop: 90,
    textAlign: "center",
  },
  link: {
    marginTop: 60,
    textAlign: "center",
  },
  buttonText: {
    color: Colors.Contrast,
    fontSize: Fonts.Button,
    paddingRight: Layout.Container,
  },
  button: {
    display: "flex",
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "space-evenly",
    minWidth: "40%",
    padding: Layout.Container,
    borderRadius: Layout.Corners,
    backgroundColor: Colors.Action,
  },
})
