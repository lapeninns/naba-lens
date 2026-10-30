export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      media_archive_receipts: {
        Row: {
          id: number
          asset_id: string
          sha256: string
          size_bytes: number
          mime_type: string
          source_project_ref: string
          source_key: string
          blob_key: string
          manifest_key: string
          manifest_sha256: string
          manifest: Json
          archived_at: string
        }
        Insert: {
          id?: never
          asset_id: string
          sha256: string
          size_bytes: number
          mime_type: string
          source_project_ref: string
          source_key: string
          blob_key: string
          manifest_key: string
          manifest_sha256: string
          manifest: Json
          archived_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: [
          {
            foreignKeyName: "media_archive_receipts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_archive_audit_state: {
        Row: {
          name: string
          cursor_id: number
          last_run_at: string | null
          last_complete_at: string | null
          last_error: string | null
        }
        Insert: {
          name: string
          cursor_id?: number
          last_run_at?: string | null
          last_complete_at?: string | null
          last_error?: string | null
        }
        Update: {
          cursor_id?: number
          last_run_at?: string | null
          last_complete_at?: string | null
          last_error?: string | null
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          client_upload_key: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path: string | null
          size_bytes: number | null
          thumbnail_path: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          validated_mime_type: string | null
          venue_id: string
          width: number | null
        }
        Insert: {
          client_upload_key?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path?: string | null
          size_bytes?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          validated_mime_type?: string | null
          venue_id: string
          width?: number | null
        }
        Update: {
          client_upload_key?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          original_filename?: string
          original_path?: string
          preview_path?: string | null
          size_bytes?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["upload_state"]
          uploader_id?: string
          validated_mime_type?: string | null
          venue_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      media_label_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["app_role"] | null
          after: Json | null
          asset_id: string
          before: Json | null
          created_at: string
          id: number
          venue_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          after?: Json | null
          asset_id: string
          before?: Json | null
          created_at?: string
          id?: never
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          after?: Json | null
          asset_id?: string
          before?: Json | null
          created_at?: string
          id?: never
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_label_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_label_items: {
        Row: {
          added_at: string
          added_by: string | null
          asset_id: string
          id: string
          item_id: string
          item_name: string
          section_name: string | null
          section_slug: string | null
          variant_id: string | null
          variant_name: string | null
          venue_id: string
          version_id: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          asset_id: string
          id?: string
          item_id: string
          item_name: string
          section_name?: string | null
          section_slug?: string | null
          variant_id?: string | null
          variant_name?: string | null
          venue_id: string
          version_id?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          asset_id?: string
          id?: string
          item_id?: string
          item_name?: string
          section_name?: string | null
          section_slug?: string | null
          variant_id?: string | null
          variant_name?: string | null
          venue_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_label_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_label_items_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_label_items_label_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_labels"
            referencedColumns: ["asset_id", "venue_id"]
          },
          {
            foreignKeyName: "media_label_items_variant_fkey"
            columns: ["variant_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_variants"
            referencedColumns: ["id", "item_id"]
          },
          {
            foreignKeyName: "media_label_items_version_fkey"
            columns: ["version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      media_labels: {
        Row: {
          asset_id: string
          content_types: string[]
          created_at: string
          has_labels: boolean
          note: string | null
          revision: number
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          asset_id: string
          content_types?: string[]
          created_at?: string
          has_labels?: boolean
          note?: string | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          asset_id?: string
          content_types?: string[]
          created_at?: string
          has_labels?: boolean
          note?: string | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_labels_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: true
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_labels_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_entries: {
        Row: {
          aliases: string[]
          description: string | null
          id: string
          item_id: string
          name: string
          needs_review: boolean
          position: number
          review_candidates: string[]
          review_reason: string | null
          section_id: string
          source_key: string
          source_meta: Json
          venue_id: string
          version_id: string
        }
        Insert: {
          aliases?: string[]
          description?: string | null
          id?: string
          item_id: string
          name: string
          needs_review?: boolean
          position: number
          review_candidates?: string[]
          review_reason?: string | null
          section_id: string
          source_key: string
          source_meta?: Json
          venue_id: string
          version_id: string
        }
        Update: {
          aliases?: string[]
          description?: string | null
          id?: string
          item_id?: string
          name?: string
          needs_review?: boolean
          position?: number
          review_candidates?: string[]
          review_reason?: string | null
          section_id?: string
          source_key?: string
          source_meta?: Json
          venue_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_entries_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_entries_section_fkey"
            columns: ["section_id", "version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_sections"
            referencedColumns: ["id", "version_id", "venue_id"]
          },
          {
            foreignKeyName: "menu_entries_version_fkey"
            columns: ["version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      menu_entry_variants: {
        Row: {
          entry_id: string
          id: string
          item_id: string
          name: string
          position: number
          variant_id: string
        }
        Insert: {
          entry_id: string
          id?: string
          item_id: string
          name: string
          position: number
          variant_id: string
        }
        Update: {
          entry_id?: string
          id?: string
          item_id?: string
          name?: string
          position?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_entry_variants_entry_fkey"
            columns: ["entry_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_entries"
            referencedColumns: ["id", "item_id"]
          },
          {
            foreignKeyName: "menu_entry_variants_variant_fkey"
            columns: ["variant_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_variants"
            referencedColumns: ["id", "item_id"]
          },
        ]
      }
      menu_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          id: number
          item_id: string | null
          venue_id: string
          version_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          item_id?: string | null
          venue_id: string
          version_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          item_id?: string | null
          venue_id?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_suggestions: {
        Row: {
          asset_id: string | null
          created_at: string
          created_by: string | null
          id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_item_id: string | null
          status: string
          suggested_name: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_item_id?: string | null
          status?: string
          suggested_name: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_item_id?: string | null
          status?: string
          suggested_name?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_suggestions_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_suggestions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_suggestions_item_fkey"
            columns: ["resolved_item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_suggestions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_suggestions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          id: string
          venue_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          venue_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_sections: {
        Row: {
          id: string
          kind: string
          name: string
          position: number
          slug: string
          venue_id: string
          version_id: string
        }
        Insert: {
          id?: string
          kind?: string
          name: string
          position: number
          slug: string
          venue_id: string
          version_id: string
        }
        Update: {
          id?: string
          kind?: string
          name?: string
          position?: number
          slug?: string
          venue_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_sections_version_fkey"
            columns: ["version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      menu_variants: {
        Row: {
          created_at: string
          id: string
          item_id: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_variants_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      menu_versions: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          based_on_version_id: string | null
          created_at: string
          created_by: string | null
          id: string
          retired_at: string | null
          retired_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          source_captured_at: string | null
          source_kind: string
          source_label: string | null
          source_notes: string | null
          source_revision: string | null
          source_sha256: string | null
          status: string
          title: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          based_on_version_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          retired_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          source_captured_at?: string | null
          source_kind?: string
          source_label?: string | null
          source_notes?: string | null
          source_revision?: string | null
          source_sha256?: string | null
          status?: string
          title: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          based_on_version_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          retired_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          source_captured_at?: string | null
          source_kind?: string
          source_label?: string | null
          source_notes?: string | null
          source_revision?: string | null
          source_sha256?: string | null
          status?: string
          title?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_versions_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_versions_based_on_fkey"
            columns: ["based_on_version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_versions_retired_by_fkey"
            columns: ["retired_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_versions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_versions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          avatar_path: string | null
          created_at: string
          display_name: string
          id: string
          job_title: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          active?: boolean
          avatar_path?: string | null
          created_at?: string
          display_name: string
          id: string
          job_title?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          avatar_path?: string | null
          created_at?: string
          display_name?: string
          id?: string
          job_title?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      media_archive_backfill_candidates: {
        Args: { p_limit?: number }
        Returns: { asset_id: string }[]
      }
      media_archive_missing_count: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      acquire_maintenance_lease: {
        Args: { p_holder: string; p_name: string; p_ttl: string }
        Returns: boolean
      }
      activate_menu_version: {
        Args: { p_expected_revision: number; p_version_id: string }
        Returns: undefined
      }
      create_menu_draft: {
        Args: {
          p_based_on?: string
          p_document: Json
          p_source: Json
          p_title: string
          p_venue_id: string
        }
        Returns: string
      }
      delete_media_asset: { Args: { p_asset_id: string }; Returns: undefined }
      discard_menu_draft: { Args: { p_version_id: string }; Returns: undefined }
      fail_stale_media_processing: {
        Args: { p_limit?: number; p_stale_after: string }
        Returns: {
          asset_id: string
        }[]
      }
      library_assets: {
        Args: {
          p_category?: string
          p_content_type?: string
          p_item?: string
          p_label_state?: string
          p_query?: string
          p_variant?: string
        }
        Returns: {
          client_upload_key: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path: string | null
          size_bytes: number | null
          thumbnail_path: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          validated_mime_type: string | null
          venue_id: string
          width: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "media_assets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      media_label_details: {
        Args: { p_asset_ids: string[] }
        Returns: {
          added_at: string
          asset_id: string
          item_id: string
          name: string
          section_name: string
          section_slug: string
          snapshot_name: string
          snapshot_section_name: string
          snapshot_variant_name: string
          state: string
          variant_id: string
          variant_name: string
        }[]
      }
      prepare_media_cleanup: {
        Args: {
          p_abandoned_after: string
          p_exclude_asset_ids?: string[]
          p_limit?: number
          p_now?: string
        }
        Returns: {
          asset_id: string
          object_names: string[]
          upload_state: Database["public"]["Enums"]["upload_state"]
        }[]
      }
      release_maintenance_lease: {
        Args: { p_holder: string; p_name: string }
        Returns: undefined
      }
      reserve_media_asset: {
        Args: {
          p_client_upload_key?: string
          p_extension: string
          p_media_type: Database["public"]["Enums"]["media_type"]
          p_original_filename: string
          p_size_bytes?: number
        }
        Returns: {
          id: string
          original_path: string
          reused: boolean
          upload_state: Database["public"]["Enums"]["upload_state"]
          venue_id: string
        }[]
      }
      resolve_menu_item_suggestion: {
        Args: {
          p_item_id?: string
          p_note?: string
          p_status: string
          p_suggestion_id: string
        }
        Returns: undefined
      }
      retire_menu_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      save_media_labels: {
        Args: {
          p_asset_id: string
          p_catalogue_version_id?: string
          p_content_types: string[]
          p_expected_revision: number
          p_items: Json
          p_missing_item?: string
          p_note: string
        }
        Returns: {
          has_labels: boolean
          revision: number
        }[]
      }
      save_menu_draft: {
        Args: {
          p_document: Json
          p_expected_revision: number
          p_version_id: string
        }
        Returns: number
      }
      set_menu_item_archived: {
        Args: { p_archived: boolean; p_item_id: string }
        Returns: undefined
      }
      take_over_stale_media_claim: {
        Args: { p_asset_id: string; p_stale_after: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "staff" | "admin"
      media_type: "image" | "video"
      upload_state: "uploading" | "processing" | "ready" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["staff", "admin"],
      media_type: ["image", "video"],
      upload_state: ["uploading", "processing", "ready", "failed"],
    },
  },
} as const
