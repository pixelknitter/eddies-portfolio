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
      <Text style={styles.title}>About</Text>
      <View style={styles.content}>
        <Text style={styles.body}>
          Lorem ipsum, dolor sit amet consectetur adipisicing elit. Autem
          commodi repudiandae recusandae cumque, modi beatae nostrum? Officia
          praesentium rerum, laboriosam deserunt itaque quod quasi illo impedit
          doloremque, eius consequatur quia!
        </Text>
        <Text style={styles.body}>
          Lorem ipsum, dolor sit amet consectetur adipisicing elit. Autem
          commodi repudiandae recusandae cumque, modi beatae nostrum? Officia
          praesentium rerum, laboriosam deserunt itaque quod quasi illo impedit
          doloremque, eius consequatur quia!
        </Text>
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
    backgroundColor: Colors.Contrast,
    flex: 1,
    paddingHorizontal: Layout.Container * 2,
    paddingVertical: Layout.Container,
    justifyContent: "space-evenly",
  },
  title: {
    fontSize: Fonts.Title,
    fontWeight: "bold",
    color: Colors.Primary,
  },
  content: {
    paddingVertical: Layout.Container * 2,
  },
  body: {
    fontSize: Fonts.Body,
    marginBottom: Layout.Paragraph,
    color: Colors.Secondary,
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
