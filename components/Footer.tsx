import { useRouter, useSegments } from "expo-router"
import { Text, StyleSheet, View, Pressable } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Colors } from "../styles/Colors"
import { Fonts } from "../styles/Fonts"
import { Layout } from "../styles/Layout"

export const Footer: React.FC = () => {
  const segments = useSegments()
  const router = useRouter()
  const { bottom: bottomInset } = useSafeAreaInsets()
  const showBackButton = segments?.length
  return (
    <>
      {showBackButton ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: bottomInset + Layout.Container * 1.5 },
          ]}
        >
          {showBackButton && (
            <Pressable style={styles.button} onPress={() => router.back()}>
              <Text style={styles.buttonText}>Go Back</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.Contrast,
  },
  button: {
    backgroundColor: Colors.Action,
    width: "100%",
    padding: Layout.Container,
    borderRadius: Layout.Corners,
  },
  buttonText: {
    textAlign: "center",
    fontSize: Fonts.Button,
    fontWeight: "bold",
    color: Colors.Contrast,
  },
})
