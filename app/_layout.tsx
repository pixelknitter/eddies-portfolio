import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "react-query"
import {
  // Import `SplashScreen` from `expo-router` instead of `expo-splash-screen`
  SplashScreen,

  // This example uses a basic Layout component, but you can use any Layout.
  Slot,
} from "expo-router"

import { useFonts, Inter_500Medium } from "@expo-google-fonts/inter"
import Entypo from "@expo/vector-icons/Entypo"
import * as Font from "expo-font"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"

const queryClient = new QueryClient()

export default function Layout() {
  const [appIsReady, setAppIsReady] = useState(false)
  // Load the font `Inter_500Medium`
  const [fontsLoaded] = useFonts({
    Inter_500Medium,
  })

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load fonts, make any API calls you need to do here
        await Font.loadAsync(Entypo.font)
        // TODO: Pre-load other data that's needed
      } catch (e) {
        console.warn(e)
      } finally {
        // Tell the application to render
        setAppIsReady(true)
      }
    }

    prepare()
  }, [])

  if (!fontsLoaded && !appIsReady) {
    // The native splash screen will stay visible for as long as there
    // are `<SplashScreen />` components mounted. This component can be nested.

    return <SplashScreen />
  }

  // Render the children routes now that all the assets are loaded.
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        {/* <Header /> */}
        <Slot />
        {/* <Footer /> */}
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
