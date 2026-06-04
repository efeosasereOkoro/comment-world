export interface Site {
  id: string;
  owner_id: string;
  name: string;
  allowed_origins: string[];
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  site_id: string;
  page: string;
  selector: string | null;
  quote: string | null;
  author: string | null;
  content: string | null;
  created_at: string;
}
