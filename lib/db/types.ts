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
      coverage_amenity_templates: {
        Row: {
          active: boolean
          default_guidance: string | null
          key: string
          kind: string
          needs_fact: boolean
          position: number
          suggested_photo_target: number
          title: string
        }
        Insert: {
          active?: boolean
          default_guidance?: string | null
          key: string
          kind: string
          needs_fact?: boolean
          position: number
          suggested_photo_target?: number
          title: string
        }
        Update: {
          active?: boolean
          default_guidance?: string | null
          key?: string
          kind?: string
          needs_fact?: boolean
          position?: number
          suggested_photo_target?: number
          title?: string
        }
        Relationships: []
      }
      coverage_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          historical: boolean
          id: number
          reason: string | null
          venue_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          historical?: boolean
          id?: never
          reason?: string | null
          venue_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          historical?: boolean
          id?: never
          reason?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_audit_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_preparation_runs: {
        Row: {
          already_present: number
          candidates_added: number
          error_code: string | null
          error_message: string | null
          finished_at: string
          id: string
          period_month: string
          placeholders_created: number
          requested_by: string | null
          run_trigger: string
          scope_venue_id: string | null
          staff_considered: number
          started_at: string
          status: string
          targets_copied: number
        }
        Insert: {
          already_present?: number
          candidates_added?: number
          error_code?: string | null
          error_message?: string | null
          finished_at: string
          id?: string
          period_month: string
          placeholders_created?: number
          requested_by?: string | null
          run_trigger: string
          scope_venue_id?: string | null
          staff_considered?: number
          started_at: string
          status: string
          targets_copied?: number
        }
        Update: {
          already_present?: number
          candidates_added?: number
          error_code?: string | null
          error_message?: string | null
          finished_at?: string
          id?: string
          period_month?: string
          placeholders_created?: number
          requested_by?: string | null
          run_trigger?: string
          scope_venue_id?: string | null
          staff_considered?: number
          started_at?: string
          status?: string
          targets_copied?: number
        }
        Relationships: [
          {
            foreignKeyName: "coverage_preparation_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_preparation_runs_scope_venue_id_fkey"
            columns: ["scope_venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requirement_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          end_kind: string | null
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          id: string
          requirement_id: string
          staff_id: string
          venue_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          requirement_id: string
          staff_id: string
          venue_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          requirement_id?: string
          staff_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requirement_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requirement_assignees_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requirement_assignees_requirement_fkey"
            columns: ["requirement_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "coverage_requirements"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_requirement_assignees_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_requirements: {
        Row: {
          amenity_key: string | null
          client_request_hash: string | null
          client_request_key: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          guidance: string | null
          id: string
          kind: string
          menu_plan_id: string | null
          menu_section_id: string | null
          menu_version_id: string | null
          photo_target: number
          replaced_by_requirement_id: string | null
          retire_kind: string | null
          revision: number
          section_snapshot: Json | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          status_reason: string | null
          title: string
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          amenity_key?: string | null
          client_request_hash?: string | null
          client_request_key?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          guidance?: string | null
          id?: string
          kind: string
          menu_plan_id?: string | null
          menu_section_id?: string | null
          menu_version_id?: string | null
          photo_target?: number
          replaced_by_requirement_id?: string | null
          retire_kind?: string | null
          revision?: number
          section_snapshot?: Json | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          amenity_key?: string | null
          client_request_hash?: string | null
          client_request_key?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          guidance?: string | null
          id?: string
          kind?: string
          menu_plan_id?: string | null
          menu_section_id?: string | null
          menu_version_id?: string | null
          photo_target?: number
          replaced_by_requirement_id?: string | null
          retire_kind?: string | null
          revision?: number
          section_snapshot?: Json | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_requirements_amenity_key_fkey"
            columns: ["amenity_key"]
            isOneToOne: false
            referencedRelation: "coverage_amenity_templates"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "coverage_requirements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requirements_plan_fkey"
            columns: ["menu_plan_id", "menu_version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_coverage_plans"
            referencedColumns: ["id", "menu_version_id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_requirements_replaced_by_fkey"
            columns: ["replaced_by_requirement_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "coverage_requirements"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_requirements_section_fkey"
            columns: ["menu_section_id", "menu_version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_sections"
            referencedColumns: ["id", "version_id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_requirements_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requirements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_requirements_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_review_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          author_id: string
          cleared_replaces_item_id: string | null
          client_request_key: string | null
          created_at: string
          from_state: string | null
          id: number
          item_id: string
          reason: string | null
          requirement_id: string | null
          revision: number
          self_review: boolean
          to_state: string
          venue_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          author_id: string
          cleared_replaces_item_id?: string | null
          client_request_key?: string | null
          created_at?: string
          from_state?: string | null
          id?: never
          item_id: string
          reason?: string | null
          requirement_id?: string | null
          revision: number
          self_review?: boolean
          to_state: string
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          author_id?: string
          cleared_replaces_item_id?: string | null
          client_request_key?: string | null
          created_at?: string
          from_state?: string | null
          id?: never
          item_id?: string
          reason?: string | null
          requirement_id?: string | null
          revision?: number
          self_review?: boolean
          to_state?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_review_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_review_events_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_review_events_cleared_replaces_item_id_fkey"
            columns: ["cleared_replaces_item_id"]
            isOneToOne: false
            referencedRelation: "coverage_submission_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_review_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "coverage_submission_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_review_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_submission_items: {
        Row: {
          archive_kind: string | null
          archived_at: string | null
          asset_id: string
          author_id: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          origin: string
          reconciled_from_item_id: string | null
          replaces_item_id: string | null
          requirement_id: string | null
          revision: number
          self_review: boolean | null
          state: string
          submission_id: string
          submitted_at: string
          submitted_by: string
          submitted_month: string
          updated_at: string
          uploaded_at: string
          uploaded_month: string
          venue_id: string
        }
        Insert: {
          archive_kind?: string | null
          archived_at?: string | null
          asset_id: string
          author_id: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          origin: string
          reconciled_from_item_id?: string | null
          replaces_item_id?: string | null
          requirement_id?: string | null
          revision?: number
          self_review?: boolean | null
          state?: string
          submission_id: string
          submitted_at?: string
          submitted_by: string
          submitted_month: string
          updated_at?: string
          uploaded_at: string
          uploaded_month: string
          venue_id: string
        }
        Update: {
          archive_kind?: string | null
          archived_at?: string | null
          asset_id?: string
          author_id?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          origin?: string
          reconciled_from_item_id?: string | null
          replaces_item_id?: string | null
          requirement_id?: string | null
          revision?: number
          self_review?: boolean | null
          state?: string
          submission_id?: string
          submitted_at?: string
          submitted_by?: string
          submitted_month?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_month?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_submission_items_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_submission_items_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_submission_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_submission_items_reconciled_from_item_id_fkey"
            columns: ["reconciled_from_item_id"]
            isOneToOne: false
            referencedRelation: "coverage_submission_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_submission_items_replaces_item_id_fkey"
            columns: ["replaces_item_id"]
            isOneToOne: false
            referencedRelation: "coverage_submission_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_submission_items_requirement_fkey"
            columns: ["requirement_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "coverage_requirements"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_submission_items_submission_fkey"
            columns: ["submission_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "coverage_submissions"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_submission_items_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_submissions: {
        Row: {
          asset_ids: string[]
          client_request_key: string
          created_at: string
          id: string
          kind: string
          requirement_id: string | null
          submitted_by: string
          venue_id: string
        }
        Insert: {
          asset_ids: string[]
          client_request_key: string
          created_at?: string
          id?: string
          kind: string
          requirement_id?: string | null
          submitted_by: string
          venue_id: string
        }
        Update: {
          asset_ids?: string[]
          client_request_key?: string
          created_at?: string
          id?: string
          kind?: string
          requirement_id?: string | null
          submitted_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_submissions_requirement_fkey"
            columns: ["requirement_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "coverage_requirements"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "coverage_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_submissions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      media_archive_audit_runs: {
        Row: {
          bytes_verified: number
          checked: number
          copied: number
          cursor_from: number | null
          cursor_to: number | null
          cycle_id: string | null
          error: string | null
          finished_at: string
          id: number
          missing: number | null
          outcome: string
          run_id: string
          started_at: string
        }
        Insert: {
          bytes_verified?: number
          checked?: number
          copied?: number
          cursor_from?: number | null
          cursor_to?: number | null
          cycle_id?: string | null
          error?: string | null
          finished_at: string
          id?: never
          missing?: number | null
          outcome: string
          run_id: string
          started_at: string
        }
        Update: {
          bytes_verified?: number
          checked?: number
          copied?: number
          cursor_from?: number | null
          cursor_to?: number | null
          cycle_id?: string | null
          error?: string | null
          finished_at?: string
          id?: never
          missing?: number | null
          outcome?: string
          run_id?: string
          started_at?: string
        }
        Relationships: []
      }
      media_archive_audit_state: {
        Row: {
          consecutive_failures: number
          cursor_id: number
          cycle_checked: number
          cycle_id: string | null
          cycle_started_at: string | null
          cycle_target_count: number | null
          cycle_target_id: number | null
          last_complete_at: string | null
          last_complete_cycle_started_at: string | null
          last_cycle_duration_seconds: number | null
          last_error: string | null
          last_run_at: string | null
          last_run_outcome: string | null
          name: string
        }
        Insert: {
          consecutive_failures?: number
          cursor_id?: number
          cycle_checked?: number
          cycle_id?: string | null
          cycle_started_at?: string | null
          cycle_target_count?: number | null
          cycle_target_id?: number | null
          last_complete_at?: string | null
          last_complete_cycle_started_at?: string | null
          last_cycle_duration_seconds?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_run_outcome?: string | null
          name: string
        }
        Update: {
          consecutive_failures?: number
          cursor_id?: number
          cycle_checked?: number
          cycle_id?: string | null
          cycle_started_at?: string | null
          cycle_target_count?: number | null
          cycle_target_id?: number | null
          last_complete_at?: string | null
          last_complete_cycle_started_at?: string | null
          last_cycle_duration_seconds?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_run_outcome?: string | null
          name?: string
        }
        Relationships: []
      }
      media_archive_receipts: {
        Row: {
          archived_at: string
          asset_id: string
          blob_key: string
          id: number
          manifest: Json
          manifest_key: string
          manifest_sha256: string
          mime_type: string
          sha256: string
          size_bytes: number
          source_key: string
          source_project_ref: string
        }
        Insert: {
          archived_at?: string
          asset_id: string
          blob_key: string
          id?: never
          manifest: Json
          manifest_key: string
          manifest_sha256: string
          mime_type: string
          sha256: string
          size_bytes: number
          source_key: string
          source_project_ref: string
        }
        Update: {
          archived_at?: string
          asset_id?: string
          blob_key?: string
          id?: never
          manifest?: Json
          manifest_key?: string
          manifest_sha256?: string
          mime_type?: string
          sha256?: string
          size_bytes?: number
          source_key?: string
          source_project_ref?: string
        }
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
      menu_coverage_plans: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          discarded_at: string | null
          discarded_by: string | null
          id: string
          menu_version_id: string
          previous_plan_id: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_required: boolean
          revision: number
          status: string
          superseded_at: string | null
          updated_at: string
          venue_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          menu_version_id: string
          previous_plan_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_required?: boolean
          revision?: number
          status?: string
          superseded_at?: string | null
          updated_at?: string
          venue_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          menu_version_id?: string
          previous_plan_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_required?: boolean
          revision?: number
          status?: string
          superseded_at?: string | null
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_coverage_plans_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_previous_fkey"
            columns: ["previous_plan_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_coverage_plans"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_coverage_plans_version_fkey"
            columns: ["menu_version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
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
      monthly_targets: {
        Row: {
          copied_from_target_id: string | null
          created_at: string
          created_by: string | null
          due_on: string
          id: string
          period_month: string
          revision: number
          source: string
          staff_id: string
          target_count: number | null
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          copied_from_target_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on: string
          id?: string
          period_month: string
          revision?: number
          source: string
          staff_id: string
          target_count?: number | null
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          copied_from_target_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string
          id?: string
          period_month?: string
          revision?: number
          source?: string
          staff_id?: string
          target_count?: number | null
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_targets_copied_from_target_id_fkey"
            columns: ["copied_from_target_id"]
            isOneToOne: false
            referencedRelation: "monthly_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_targets_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_targets_venue_id_fkey"
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
          department: string | null
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
          department?: string | null
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
          department?: string | null
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
      venue_amenity_fact_media: {
        Row: {
          added_at: string
          added_by: string | null
          asset_id: string
          fact_id: string
          venue_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          asset_id: string
          fact_id: string
          venue_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          asset_id?: string
          fact_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_amenity_fact_media_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_fact_media_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "venue_amenity_fact_media_fact_fkey"
            columns: ["fact_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_facts"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      venue_amenity_facts: {
        Row: {
          amenity_key: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          facts: string | null
          id: string
          policy: string | null
          presence: string
          revision: number
          updated_at: string
          updated_by: string | null
          venue_id: string
        }
        Insert: {
          amenity_key: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          facts?: string | null
          id?: string
          policy?: string | null
          presence?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
          venue_id: string
        }
        Update: {
          amenity_key?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          facts?: string | null
          id?: string
          policy?: string | null
          presence?: string
          revision?: number
          updated_at?: string
          updated_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_amenity_facts_amenity_key_fkey"
            columns: ["amenity_key"]
            isOneToOne: false
            referencedRelation: "coverage_amenity_templates"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "venue_amenity_facts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_facts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_facts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_manager_grants: {
        Row: {
          grant_reason: string | null
          granted_at: string
          granted_by: string
          id: string
          revoke_kind: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          staff_id: string
          venue_id: string
        }
        Insert: {
          grant_reason?: string | null
          granted_at?: string
          granted_by: string
          id?: string
          revoke_kind?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          staff_id: string
          venue_id: string
        }
        Update: {
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string
          id?: string
          revoke_kind?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          staff_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_manager_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_manager_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_manager_grants_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_manager_grants_venue_id_fkey"
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
      acquire_maintenance_lease: {
        Args: { p_holder: string; p_name: string; p_ttl: string }
        Returns: boolean
      }
      activate_menu_version: {
        Args: { p_expected_revision: number; p_version_id: string }
        Returns: undefined
      }
      attach_coverage_evidence: {
        Args: {
          p_accept?: boolean
          p_asset_ids: string[]
          p_client_request_key: string
          p_requirement_id: string
        }
        Returns: {
          asset_id: string
          item_id: string
          replayed: boolean
          reused: boolean
          revision: number
          state: string
        }[]
      }
      claim_archive_monitor_alert: { Args: never; Returns: Json }
      community_media_page: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_department?: string
          p_limit?: number
          p_type?: Database["public"]["Enums"]["media_type"]
          p_uploader?: string
          p_venue?: string
        }
        Returns: {
          contributor_name: string
          created_at: string
          duration_seconds: number | null
          has_preview: boolean
          has_thumbnail: boolean
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string | null
          size_bytes: number | null
          uploader_id: string
          validated_mime_type: string | null
          venue_name: string
          width: number | null
        }[]
      }
      community_members: {
        Args: {
          p_department?: string
          p_limit?: number
          p_member?: string
          p_offset?: number
          p_query?: string
          p_venue?: string
        }
        Returns: {
          avatar_path: string | null
          department: string | null
          display_name: string
          id: string
          job_title: string | null
          media_count: number
          venue_id: string | null
          venue_name: string | null
        }[]
      }
      community_readable_assets: {
        Args: { p_asset_ids: string[] }
        Returns: {
          created_at: string
          duration_seconds: number | null
          has_preview: boolean
          has_thumbnail: boolean
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          size_bytes: number | null
          uploader_id: string
          validated_mime_type: string | null
          venue_id: string
          width: number | null
        }[]
      }
      complete_archive_monitor_alert: {
        Args: { p_claim_id: string; p_event_id: string }
        Returns: boolean
      }
      confirm_menu_coverage_plan: {
        Args: { p_expected_revision: number; p_plan_id: string }
        Returns: {
          auto_retired: number
          plan_id: string
          reconciliation_required: boolean
        }[]
      }
      coverage_access_scope: {
        Args: never
        Returns: {
          active: boolean
          department: string | null
          is_admin: boolean
          manager_grant_id: string | null
          manager_venue_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          venue_active: boolean
          venue_id: string | null
        }[]
      }
      coverage_candidate_assets: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_limit?: number
          p_uploader_id?: string
          p_venue_id?: string
        }
        Returns: {
          asset_id: string
          created_at: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number | null
          live_item_id: string | null
          live_item_state: string | null
          live_requirement_id: string | null
          monthly_eligible_now: boolean
          uploaded_month: string
          uploader_active: boolean
          uploader_id: string
          uploader_name: string
          venue_id: string
          width: number | null
        }[]
      }
      coverage_group_overview: {
        Args: { p_period_month?: string }
        Returns: {
          accepted_photos: number
          amenity_unknown_count: number
          applicable_count: number
          coverage_complete: boolean
          last_preparation_at: string | null
          last_preparation_status: string | null
          menu_state: string
          needs_reassignment_count: number
          needs_setup_count: number
          overdue_count: number
          participation_complete: number
          pending_review_count: number
          satisfied_count: number
          self_review_count: number
          staff_count: number
          staff_without_target: number
          targets_needing_setup: number
          targets_set: number
          venue_id: string
          venue_name: string
        }[]
      }
      coverage_items_page: {
        Args: {
          p_after_id?: string
          p_after_submitted_at?: string
          p_author_id?: string
          p_limit?: number
          p_newest_first?: boolean
          p_period_month?: string
          p_requirement_id?: string
          p_states?: string[]
          p_venue_id?: string
        }
        Returns: {
          archived: boolean
          asset_id: string
          author_active: boolean
          author_id: string
          author_name: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          evidence_available: boolean
          has_preview: boolean
          has_thumbnail: boolean
          height: number | null
          item_id: string
          media_type: Database["public"]["Enums"]["media_type"]
          monthly_eligible: boolean
          origin: string
          replaces_item_id: string | null
          requirement_id: string | null
          requirement_title: string | null
          revision: number
          self_review: boolean | null
          state: string
          submitted_at: string
          submitted_by: string
          submitted_month: string
          uploaded_month: string
          venue_id: string
          width: number | null
        }[]
      }
      coverage_preparation_status: {
        Args: { p_venue_id?: string }
        Returns: {
          last_error_code: string | null
          last_failure_at: string | null
          last_run_at: string | null
          last_status: string | null
          last_success_at: string | null
          period_month: string
          staff_without_target: number
          targets_needing_setup: number
        }[]
      }
      coverage_requirement_progress: {
        Args: { p_include_closed?: boolean; p_venue_id: string }
        Returns: {
          accepted_count: number
          amenity_confirmed: boolean
          amenity_key: string | null
          amenity_presence: string | null
          assignee_ids: string[]
          due_on: string | null
          evidence_removed_count: number
          guidance: string | null
          is_current: boolean
          kind: string
          menu_plan_id: string | null
          menu_plan_status: string | null
          menu_version_id: string | null
          needs_another_photo_count: number
          needs_reassignment: boolean
          overdue: boolean
          pending_count: number
          photo_target: number
          requirement_id: string
          revision: number
          satisfied: boolean
          section_snapshot: Json | null
          status: string
          status_reason: string | null
          title: string
          venue_id: string
        }[]
      }
      coverage_staff_progress: {
        Args: {
          p_period_month?: string
          p_staff_id?: string
          p_venue_id?: string
        }
        Returns: {
          accepted_count: number
          avatar_path: string | null
          complete: boolean
          department: string | null
          display_name: string
          due_on: string | null
          evidence_removed_count: number
          is_current_member: boolean
          is_manager: boolean
          job_title: string | null
          late_accepted_count: number
          needs_another_photo_count: number
          needs_setup: boolean
          overdue: boolean
          pending_count: number
          period_month: string
          setup_missing: string[]
          staff_id: string
          target_count: number | null
          target_id: string | null
          target_revision: number | null
          target_source: string | null
          venue_id: string
          venue_name: string
        }[]
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
      discard_menu_coverage_plan: {
        Args: { p_expected_revision: number; p_plan_id: string }
        Returns: undefined
      }
      discard_menu_draft: { Args: { p_version_id: string }; Returns: undefined }
      fail_stale_media_processing: {
        Args: { p_limit?: number; p_stale_after: string }
        Returns: {
          asset_id: string
        }[]
      }
      grant_venue_manager: {
        Args: { p_reason?: string; p_staff_id: string; p_venue_id: string }
        Returns: string
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
      library_labelled_items: { Args: { p_venue_id: string }; Returns: Json }
      library_labelled_variants: { Args: { p_venue_id: string }; Returns: Json }
      library_page: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_candidate_cap?: number
          p_category?: string
          p_content_type?: string
          p_from?: string
          p_item?: string
          p_label_state?: string
          p_limit?: number
          p_query?: string
          p_staff?: string
          p_to?: string
          p_type?: Database["public"]["Enums"]["media_type"]
          p_variant?: string
          p_venue?: string
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
      media_archive_backfill_candidates: {
        Args: { p_limit?: number }
        Returns: {
          asset_id: string
        }[]
      }
      media_archive_missing_count: { Args: never; Returns: number }
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
      menu_label_counts: { Args: { p_venue_id: string }; Returns: Json }
      prepare_coverage_month: {
        Args: { p_venue_id?: string }
        Returns: {
          already_present: number
          candidates_added: number
          error_code: string | null
          error_message: string | null
          finished_at: string
          id: string
          period_month: string
          placeholders_created: number
          requested_by: string | null
          run_trigger: string
          scope_venue_id: string | null
          staff_considered: number
          started_at: string
          status: string
          targets_copied: number
        }[]
        SetofOptions: {
          from: "*"
          to: "coverage_preparation_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      prepare_coverage_month_scheduled: {
        Args: never
        Returns: {
          already_present: number
          candidates_added: number
          error_code: string | null
          error_message: string | null
          finished_at: string
          id: string
          period_month: string
          placeholders_created: number
          requested_by: string | null
          run_trigger: string
          scope_venue_id: string | null
          staff_considered: number
          started_at: string
          status: string
          targets_copied: number
        }[]
        SetofOptions: {
          from: "*"
          to: "coverage_preparation_runs"
          isOneToOne: false
          isSetofReturn: true
        }
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
      reconcile_menu_requirement: {
        Args: {
          p_item_ids: string[]
          p_old_requirement_id: string
          p_reason: string
          p_target_requirement_id: string
        }
        Returns: {
          carried: number
          reconciliation_complete: boolean
        }[]
      }
      record_archive_monitor_heartbeat: { Args: never; Returns: undefined }
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
      review_coverage_item: {
        Args: {
          p_client_request_key?: string
          p_decision: string
          p_expected_revision: number
          p_item_id: string
          p_reason?: string
        }
        Returns: {
          item_id: string
          replayed: boolean
          revision: number
          self_review: boolean
          state: string
        }[]
      }
      revoke_venue_manager: {
        Args: { p_grant_id: string; p_reason: string }
        Returns: undefined
      }
      save_coverage_requirement: {
        Args: {
          p_client_request_key?: string
          p_due_on: string
          p_expected_revision: number
          p_guidance: string
          p_kind: string
          p_photo_target: number
          p_requirement_id: string
          p_title: string
          p_venue_id: string
        }
        Returns: {
          replayed: boolean
          requirement_id: string
          revision: number
        }[]
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
      set_amenity_fact: {
        Args: {
          p_amenity_key: string
          p_asset_ids?: string[]
          p_confirm: boolean
          p_expected_revision: number
          p_facts: string
          p_policy: string
          p_presence: string
          p_venue_id: string
        }
        Returns: {
          fact_id: string
          revision: number
        }[]
      }
      set_coverage_requirement_assignees: {
        Args: {
          p_reason?: string
          p_requirement_id: string
          p_staff_ids: string[]
        }
        Returns: {
          assignment_id: string
          staff_id: string
        }[]
      }
      set_coverage_requirement_status: {
        Args: {
          p_expected_revision: number
          p_reason?: string
          p_requirement_id: string
          p_status: string
        }
        Returns: number
      }
      set_menu_item_archived: {
        Args: { p_archived: boolean; p_item_id: string }
        Returns: undefined
      }
      set_monthly_target: {
        Args: {
          p_due_on?: string
          p_expected_revision?: number
          p_period_month: string
          p_reason?: string
          p_staff_id: string
          p_target_count: number
          p_venue_id: string
        }
        Returns: {
          revision: number
          target_id: string
        }[]
      }
      start_menu_coverage_plan: {
        Args: { p_menu_version_id: string; p_venue_id: string }
        Returns: {
          created: boolean
          plan_id: string
          revision: number
        }[]
      }
      submit_coverage_photos: {
        Args: {
          p_asset_ids: string[]
          p_client_request_key?: string
          p_replaces_item_id?: string
          p_requirement_id?: string
        }
        Returns: {
          asset_id: string
          item_id: string
          replayed: boolean
          reused: boolean
          revision: number
          state: string
        }[]
      }
      take_over_stale_media_claim: {
        Args: { p_asset_id: string; p_stale_after: string }
        Returns: boolean
      }
      task_evidence_asset: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number | null
          media_type: Database["public"]["Enums"]["media_type"]
          uploader_id: string
          validated_mime_type: string | null
          venue_id: string
          width: number | null
        }[]
      }
      venue_coverage_summary: {
        Args: { p_venue_id?: string }
        Returns: {
          active_menu_version_id: string | null
          amenity_unknown_count: number
          applicable_count: number
          complete: boolean
          current_plan_id: string | null
          draft_plan_id: string | null
          menu_state: string
          needs_reassignment_count: number
          needs_setup_count: number
          not_applicable_count: number
          overdue_count: number
          pending_reconciliation_count: number
          pending_review_count: number
          satisfied_count: number
          venue_active: boolean
          venue_id: string
          venue_name: string
        }[]
      }
      venue_manager_grant_list: {
        Args: { p_include_revoked?: boolean; p_venue_id?: string }
        Returns: {
          effective: boolean
          grant_id: string
          grant_reason: string | null
          granted_at: string
          granted_by: string
          granted_by_name: string
          revoke_kind: string | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by_name: string | null
          staff_active: boolean
          staff_id: string
          staff_name: string
          staff_venue_id: string | null
          venue_id: string
          venue_name: string
        }[]
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
