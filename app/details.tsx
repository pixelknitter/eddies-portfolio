import { Text, StyleSheet, Pressable, View } from "react-native"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { Colors } from "../styles/Colors"
import { Layout } from "../styles/Layout"
import { Fonts } from "../styles/Fonts"

export default function Details() {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Details Screen</Text>
      <View style={styles.content}>
        <Text style={styles.body}>
          Lorem ipsum, dolor sit amet consectetur adipisicing elit. Autem
          commodi repudiandae recusandae cumque, modi beatae nostrum? Officia
          praesentium rerum, laboriosam deserunt itaque quod quasi illo impedit
          doloremque, eius consequatur quia!
        </Text>
      </View>
      <Pressable style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Go Back</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    padding: Layout.Container,
    justifyContent: "space-between",
  },
  title: {
    fontSize: Fonts.Title,
    fontWeight: "bold",
    color: "black",
  },
  content: {
    paddingHorizontal: Layout.Container,
    paddingVertical: Layout.Container * 2,
  },
  body: {
    fontSize: Fonts.Body,
  },
  button: {
    backgroundColor: Colors.Primary,
    width: "80%",
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
