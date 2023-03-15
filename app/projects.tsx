import {
  Text,
  StyleSheet,
  Pressable,
  View,
  FlatList,
  type ListRenderItemInfo,
} from "react-native"
import { useCallback } from "react"
import { SafeAreaView } from "react-native-safe-area-context"
import { openBrowserAsync } from "expo-web-browser"

import type { Project } from "../types/projects"
import { useProjects } from "../hooks/useProjects"
import { Colors } from "../styles/Colors"
import { Layout } from "../styles/Layout"
import { Fonts } from "../styles/Fonts"

// ---- TEST DATA ----
// const PROJECTS: Project[] = [
//   {
//     id: 0,
//     name: "Text Project",
//     description:
//       "Lorem ipsum dolor sit amet consectetur, adipisicing elit. Ab nesciunt labore sint, quasi cum, laudantium cupiditate ad dolores quod praesentium itaque consequuntur facere. Perspiciatis, illum. Distinctio quisquam expedita voluptates sunt!",
//     links: {
//       code: "https://github.com/",
//       demo: "https://github.com/",
//     },
//     date: new Date("01/10/2023"),
//   },
// ]

export default function Details() {
  const { data: projects, isLoading, isLoadingError } = useProjects()

  // set up the flatlist functions
  const keyExtractor = (item: Project) => `${item.id}`
  const renderItem = useCallback(({ item }: ListRenderItemInfo<Project>) => {
    // TODO: clean this up so it has a better error message and UX
    const _handlePressButtonAsync = async () => {
      let result
      try {
        result = await openBrowserAsync(item.links.code)
      } catch (error) {
        alert(`${result?.type} - ${error}`)
      }
    }
    return (
      <Pressable style={styles.projectItem} onPress={_handlePressButtonAsync}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.body}>{item.description}</Text>
      </Pressable>
    )
  }, [])

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.body}>
          Here are some projects that I've engineered over the years to present
          my growing skills.
        </Text>
        {/* TODO: migrate to a matching pattern for improved error handling */}
        {isLoading || isLoadingError ? (
          // TODO: move to a loading animation
          <Text style={styles.loading}>Loading...</Text>
        ) : (
          <FlatList<Project>
            data={projects}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.projectList}
          />
        )}
      </View>
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
    paddingVertical: Layout.Container,
  },
  body: {
    fontSize: Fonts.Body,
    marginBottom: Layout.Paragraph / 4,
    color: Colors.Secondary,
  },
  projectList: {
    flex: 1,
    marginTop: Layout.Paragraph,
  },
  projectItem: {
    flex: 1,
    flexDirection: "column",
    color: Colors.Primary,
    padding: Layout.Container,
  },
  loading: {
    color: Colors.Accent,
    textAlign: "center",
    marginTop: Layout.Paragraph,
    fontSize: Fonts.Button,
    fontWeight: "bold",
  },
})
