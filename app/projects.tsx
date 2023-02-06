import {
  Text,
  StyleSheet,
  Pressable,
  View,
  FlatList,
  type ListRenderItemInfo,
} from "react-native"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { Colors } from "../styles/Colors"
import { Layout } from "../styles/Layout"
import { Fonts } from "../styles/Fonts"
import { useCallback } from "react"
import type { Project } from "../types/projects"

const PROJECTS: Project[] = [
  {
    id: 0,
    name: "Text Project",
    description:
      "Lorem ipsum dolor sit amet consectetur, adipisicing elit. Ab nesciunt labore sint, quasi cum, laudantium cupiditate ad dolores quod praesentium itaque consequuntur facere. Perspiciatis, illum. Distinctio quisquam expedita voluptates sunt!",
    links: {
      code: "https://github.com/",
      demo: "https://github.com/",
    },
    date: new Date("01/10/2023"),
  },
]

export default function Details() {
  const router = useRouter()

  // set up the flatlist functions
  const keyExtractor = (item: Project) => `${item.id}`
  const renderItem = useCallback(({ item }: ListRenderItemInfo<Project>) => {
    return <Text>{item.name}</Text>
  }, [])

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Projects</Text>
      <View style={styles.content}>
        <Text style={styles.body}>
          Lorem ipsum, dolor sit amet consectetur adipisicing elit. Autem
          commodi repudiandae recusandae cumque, modi beatae nostrum? Officia
          praesentium rerum, laboriosam deserunt itaque quod quasi illo impedit
          doloremque, eius consequatur quia!
        </Text>
        <FlatList<Project>
          data={PROJECTS}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
        />
      </View>
      <Pressable style={styles.button} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Go Back</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Layout.Container * 2,
    paddingVertical: Layout.Container,
    alignItems: "center",
    justifyContent: "space-evenly",
    backgroundColor: Colors.Contrast,
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
