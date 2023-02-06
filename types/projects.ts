export type Projects = Project[]

export type Project = {
  id: number
  name: string
  description: string
  date: Date // UTC
  links: {
    code: string
    demo: string
    store?: string
  }
  imageURL?: string
}

export interface ProjectResponse {
  projects: Project[]
}
