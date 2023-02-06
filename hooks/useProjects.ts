import axios from "axios"
import { useQuery } from "react-query"
import { PROJECTS_ENDPOINT } from "../data/client"
import type { Project, ProjectResponse } from "../types/projects"

const fetchProjects = async (): Promise<Project[]> => {
  const response = await axios.get<ProjectResponse>(PROJECTS_ENDPOINT)
  if (response.status === 200) {
    return response.data.projects
  }
  return Promise.reject(response.statusText)
}

export function useProjects() {
  return useQuery<Project[], Error>("projects", fetchProjects)
}
