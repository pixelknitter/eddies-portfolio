import { Entypo } from "@expo/vector-icons"

// get the names for our icons for stronger typing
type EntypoIconName = React.ComponentProps<typeof Entypo>["name"]

export type NavItem = {
  id: number
  title: string
  link: string
  subTitle?: string
  iconName?: EntypoIconName // https://icons.expo.fyi/
}
