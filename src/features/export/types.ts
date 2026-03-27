export type Topic = {
  id: number
  title: string
  slug: string
  origin: string
  url?: string
}

export type NormalizedPost = {
  id: number
  postNumber: number
  username: string
  name: string | null
  avatarUrl: string | null
  createdAt: string
  cookedHtml: string
  replyToPostNumber: number | null
  onlineUrl?: string | null
}

export type TopicData = {
  topic: Topic
  posts: NormalizedPost[]
}

export type ExportProgress = {
  stage: 'topic' | 'posts' | 'render' | 'download'
  done?: number
  total?: number
  message?: string
}
