import React, { useCallback, useMemo } from "react"
import {
  StyleSheet,
  Text,
  View,
  Animated,
  Pressable,
  FlatList,
  ListRenderItemInfo,
} from "react-native"

import { Entypo } from "@expo/vector-icons"
import { SplashScreen, Stack, Link } from "expo-router"
import { ResizeMode, Video } from "expo-av"
import { SafeAreaView } from "react-native-safe-area-context"
import { Layout } from "../styles/Layout"
import { Fonts } from "../styles/Fonts"
import { Colors } from "../styles/Colors"
import { NavItem } from "../types/navigation"

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync()

// Some values to modify the styling of the app
const ICON_SIZE = 30

// dummy data until we hook up React Query and setup the API
const NAV_DATA: NavItem[] = [
  {
    id: 0,
    title: "Who Am I?",
    iconName: "rocket",
    link: "about",
  },
  {
    id: 1,
    title: "Projects",
    iconName: "github",
    link: "projects",
  },
]

export default function App() {
  const opacity = useMemo(() => new Animated.Value(0), [])

  const onVideoLoad = () => {
    // https://facebook.github.io/react-native/docs/animated#timing
    Animated.timing(opacity, {
      toValue: 1,
      useNativeDriver: true,
    }).start()
  }

  // set up the flat list functions
  const keyExtractor = (item: NavItem) => `${item.id}`
  const renderItem = useCallback(({ item }: ListRenderItemInfo<NavItem>) => {
    return (
      <Link
        href={item.link}
        style={styles.link}
        // TODO: determine why the below are required to satisfy TypeScript
        accessibilityLabelledBy={undefined}
        accessibilityLanguage={undefined}
        asChild
      >
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>{item.title}</Text>
          {item.iconName && <Entypo name={item.iconName} size={ICON_SIZE} />}
        </Pressable>
      </Link>
    )
  }, [])

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
        <FlatList<NavItem>
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          data={NAV_DATA}
          style={styles.list}
        />
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
    backgroundColor: Colors.Contrast,
  },
  backgroundViewWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.Overlay,
    paddingHorizontal: Layout.Container,
  },
  video: { flex: 1 },
  title: {
    color: Colors.Accent,
    fontSize: ICON_SIZE,
    fontWeight: "bold",
    marginTop: Layout.Container * Layout.multiplier(3),
    textAlign: "center",
  },
  list: {
    marginTop: Layout.Container * Layout.multiplier(2),
  },
  link: {
    textAlign: "center",
    marginVertical: Layout.Container / 2,
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
    justifyContent: "space-between",
    padding: Layout.Container,
    borderRadius: Layout.Corners,
    backgroundColor: Colors.Action,
  },
})
