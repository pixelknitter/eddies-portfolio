import { useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Text, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Colors } from "../styles/Colors"
import { Fonts } from "../styles/Fonts"
import { Layout } from "../styles/Layout"
import { toSentenceCase } from "../utils/String"

export const Header: React.FC = () => {
  const segments = useSegments()
  const { top: topInset } = useSafeAreaInsets()
  const title = segments?.length ? toSentenceCase(segments[0]) : "Home"
  return (
    <>
      <StatusBar style="light" />
      {title !== "Home" ? (
        <View
          style={[styles.header, { paddingTop: topInset + Layout.Container }]}
        >
          <Text style={styles.title}>{title}</Text>
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.Contrast,
  },
  title: { color: Colors.Primary, fontSize: Fonts.Title, fontWeight: "bold" },
})
