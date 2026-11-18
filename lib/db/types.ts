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
      activity_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          after: Json | null
          before: Json | null
          created_at: string
          id: number
          new_revision: number | null
          object_id: string | null
          object_type: string
          old_revision: number | null
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
          id?: never
          new_revision?: number | null
          object_id?: string | null
          object_type: string
          old_revision?: number | null
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
          id?: never
          new_revision?: number | null
          object_id?: string | null
          object_type?: string
          old_revision?: number | null
          reason?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      album_brief_events: {
        Row: {
          brief: string | null
          id: number
          set_at: string
          set_by: string
          source: string
          source_key: string
          venue_id: string
        }
        Insert: {
          brief?: string | null
          id?: never
          set_at?: string
          set_by: string
          source: string
          source_key: string
          venue_id: string
        }
        Update: {
          brief?: string | null
          id?: never
          set_at?: string
          set_by?: string
          source?: string
          source_key?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_brief_events_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_brief_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      album_briefs: {
        Row: {
          brief: string
          set_at: string
          set_by: string
          source: string
          source_key: string
          venue_id: string
        }
        Insert: {
          brief: string
          set_at?: string
          set_by: string
          source: string
          source_key: string
          venue_id: string
        }
        Update: {
          brief?: string
          set_at?: string
          set_by?: string
          source?: string
          source_key?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_briefs_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_briefs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      album_place_events: {
        Row: {
          id: number
          set_at: string
          set_by: string
          source: string
          source_key: string
          subject_id: string | null
          venue_id: string
        }
        Insert: {
          id?: never
          set_at?: string
          set_by: string
          source: string
          source_key: string
          subject_id?: string | null
          venue_id: string
        }
        Update: {
          id?: never
          set_at?: string
          set_by?: string
          source?: string
          source_key?: string
          subject_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_place_events_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_place_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      album_places: {
        Row: {
          set_at: string
          set_by: string
          source: string
          source_key: string
          subject_id: string
          venue_id: string
        }
        Insert: {
          set_at?: string
          set_by: string
          source: string
          source_key: string
          subject_id: string
          venue_id: string
        }
        Update: {
          set_at?: string
          set_by?: string
          source?: string
          source_key?: string
          subject_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "album_places_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_places_subject_fkey"
            columns: ["subject_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "knowledge_subjects"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "album_places_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_catalogue: {
        Row: {
          capture_brief: string
          catalogue_version: number
          category: string
          evidence_rule: string
          is_core: boolean
          key: string
          position: number
          question: string
        }
        Insert: {
          capture_brief: string
          catalogue_version: number
          category: string
          evidence_rule: string
          is_core?: boolean
          key: string
          position: number
          question: string
        }
        Update: {
          capture_brief?: string
          catalogue_version?: number
          category?: string
          evidence_rule?: string
          is_core?: boolean
          key?: string
          position?: number
          question?: string
        }
        Relationships: []
      }
      amenity_check_events: {
        Row: {
          actor_id: string | null
          check_id: string
          created_at: string
          detail: Json
          id: number
          kind: string
          reason: string | null
          venue_id: string
        }
        Insert: {
          actor_id?: string | null
          check_id: string
          created_at?: string
          detail?: Json
          id?: never
          kind: string
          reason?: string | null
          venue_id: string
        }
        Update: {
          actor_id?: string | null
          check_id?: string
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          reason?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_check_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_check_events_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      amenity_commands: {
        Row: {
          actor_id: string
          check_id: string | null
          command: string
          created_at: string
          idempotency_key: string
          request_hash: string
          result: Json
          venue_id: string
        }
        Insert: {
          actor_id: string
          check_id?: string | null
          command: string
          created_at?: string
          idempotency_key: string
          request_hash: string
          result: Json
          venue_id: string
        }
        Update: {
          actor_id?: string
          check_id?: string | null
          command?: string
          created_at?: string
          idempotency_key?: string
          request_hash?: string
          result?: Json
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_commands_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_commands_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_photo_decisions: {
        Row: {
          action: string
          asset_id: string
          check_id: string
          decided_at: string
          decided_by: string
          id: number
          origin: string
          reason: string | null
          review_level: string
          venue_id: string
        }
        Insert: {
          action: string
          asset_id: string
          check_id: string
          decided_at?: string
          decided_by: string
          id?: never
          origin?: string
          reason?: string | null
          review_level?: string
          venue_id: string
        }
        Update: {
          action?: string
          asset_id?: string
          check_id?: string
          decided_at?: string
          decided_by?: string
          id?: never
          origin?: string
          reason?: string | null
          review_level?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_photo_decisions_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "amenity_photo_decisions_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "amenity_photo_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      amenity_photo_requirements: {
        Row: {
          question_key: string
          reason: string
          requirement: string
          updated_at: string
        }
        Insert: {
          question_key: string
          reason: string
          requirement: string
          updated_at?: string
        }
        Update: {
          question_key?: string
          reason?: string
          requirement?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_photo_requirements_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: true
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
        ]
      }
      amenity_scope_events: {
        Row: {
          actor_id: string
          applicable: boolean
          check_id: string
          created_at: string
          id: number
          reason: string
          result_revision: number
          template_key: string
          venue_id: string
        }
        Insert: {
          actor_id: string
          applicable: boolean
          check_id: string
          created_at?: string
          id?: never
          reason: string
          result_revision: number
          template_key: string
          venue_id: string
        }
        Update: {
          actor_id?: string
          applicable?: boolean
          check_id?: string
          created_at?: string
          id?: never
          reason?: string
          result_revision?: number
          template_key?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_scope_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_scope_events_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      amenity_submission_assets: {
        Row: {
          asset_id: string
          evidence_kind: string
          submission_id: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          evidence_kind: string
          submission_id: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          evidence_kind?: string
          submission_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_submission_assets_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "amenity_submission_assets_submission_fkey"
            columns: ["submission_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      amenity_submissions: {
        Row: {
          answer: string
          check_id: string
          created_at: string
          evidence_rule: string
          finding: string | null
          id: string
          idempotency_key: string
          internal_metadata: Json | null
          limitations: string | null
          reason: string | null
          redaction_confirmed: boolean | null
          result_revision: number
          source_contribution_id: string | null
          submitted_by: string
          submitter_basis: string | null
          template_version: number
          venue_id: string
        }
        Insert: {
          answer: string
          check_id: string
          created_at?: string
          evidence_rule: string
          finding?: string | null
          id?: string
          idempotency_key: string
          internal_metadata?: Json | null
          limitations?: string | null
          reason?: string | null
          redaction_confirmed?: boolean | null
          result_revision: number
          source_contribution_id?: string | null
          submitted_by: string
          submitter_basis?: string | null
          template_version: number
          venue_id: string
        }
        Update: {
          answer?: string
          check_id?: string
          created_at?: string
          evidence_rule?: string
          finding?: string | null
          id?: string
          idempotency_key?: string
          internal_metadata?: Json | null
          limitations?: string | null
          reason?: string | null
          redaction_confirmed?: boolean | null
          result_revision?: number
          source_contribution_id?: string | null
          submitted_by?: string
          submitter_basis?: string | null
          template_version?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenity_submissions_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "amenity_submissions_source_contribution_id_fkey"
            columns: ["source_contribution_id"]
            isOneToOne: true
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenity_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      area_photo_checks: {
        Row: {
          checked_on: string | null
          created_at: string
          decided_by: string
          decider_basis: string
          id: number
          kind: string
          label_id: string
          reason: string | null
          subject_id: string
          valid_until: string | null
          venue_id: string
        }
        Insert: {
          checked_on?: string | null
          created_at?: string
          decided_by: string
          decider_basis: string
          id?: never
          kind: string
          label_id: string
          reason?: string | null
          subject_id: string
          valid_until?: string | null
          venue_id: string
        }
        Update: {
          checked_on?: string | null
          created_at?: string
          decided_by?: string
          decider_basis?: string
          id?: never
          kind?: string
          label_id?: string
          reason?: string | null
          subject_id?: string
          valid_until?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_photo_checks_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_photo_checks_label_fkey"
            columns: ["label_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_area_labels"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      area_photo_decisions: {
        Row: {
          action: string
          asset_id: string
          decided_at: string
          decided_by: string
          id: number
          label_id: string
          reason: string | null
          review_level: string
          venue_id: string
        }
        Insert: {
          action: string
          asset_id: string
          decided_at?: string
          decided_by: string
          id?: never
          label_id: string
          reason?: string | null
          review_level?: string
          venue_id: string
        }
        Update: {
          action?: string
          asset_id?: string
          decided_at?: string
          decided_by?: string
          id?: never
          label_id?: string
          reason?: string | null
          review_level?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_photo_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_photo_decisions_label_fkey"
            columns: ["label_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_area_labels"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      contribution_notice_acknowledgements: {
        Row: {
          acknowledged_at: string
          id: string
          notice_version: string
          profile_id: string
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          notice_version: string
          profile_id: string
        }
        Update: {
          acknowledged_at?: string
          id?: string
          notice_version?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contribution_notice_acknowledgements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
          targets_defaulted: number
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
          targets_defaulted?: number
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
          targets_defaulted?: number
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
      evidence_documents: {
        Row: {
          client_upload_key: string
          created_at: string
          declared_size_bytes: number
          deleted_at: string | null
          id: string
          object_path: string
          original_filename: string
          purpose: string
          sha256: string | null
          size_bytes: number | null
          updated_at: string
          upload_state: string
          uploaded_by: string
          uploader_role: Database["public"]["Enums"]["app_role"]
          validated_mime_type: string | null
          venue_id: string
        }
        Insert: {
          client_upload_key: string
          created_at?: string
          declared_size_bytes: number
          deleted_at?: string | null
          id?: string
          object_path: string
          original_filename: string
          purpose: string
          sha256?: string | null
          size_bytes?: number | null
          updated_at?: string
          upload_state?: string
          uploaded_by: string
          uploader_role: Database["public"]["Enums"]["app_role"]
          validated_mime_type?: string | null
          venue_id: string
        }
        Update: {
          client_upload_key?: string
          created_at?: string
          declared_size_bytes?: number
          deleted_at?: string | null
          id?: string
          object_path?: string
          original_filename?: string
          purpose?: string
          sha256?: string | null
          size_bytes?: number | null
          updated_at?: string
          upload_state?: string
          uploaded_by?: string
          uploader_role?: Database["public"]["Enums"]["app_role"]
          validated_mime_type?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_documents_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      export_package_downloads: {
        Row: {
          completed_at: string | null
          downloaded_by: string
          failed_at: string | null
          files: Json | null
          id: string
          package_id: string
          started_at: string
        }
        Insert: {
          completed_at?: string | null
          downloaded_by: string
          failed_at?: string | null
          files?: Json | null
          id?: string
          package_id: string
          started_at?: string
        }
        Update: {
          completed_at?: string | null
          downloaded_by?: string
          failed_at?: string | null
          files?: Json | null
          id?: string
          package_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_package_downloads_downloaded_by_fkey"
            columns: ["downloaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_package_downloads_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "export_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      export_package_items: {
        Row: {
          alt_text: string | null
          approval_id: string
          approval_kind: string
          approval_level: string
          approval_version: string
          asset_id: string
          caption: string | null
          category: string
          filename_stem: string
          package_id: string
          position: number
          subject_id: string
          subject_kind: string
          subject_label: string
          uploaded_at: string
          use_restrictions: string[]
          venue_id: string
        }
        Insert: {
          alt_text?: string | null
          approval_id: string
          approval_kind: string
          approval_level: string
          approval_version: string
          asset_id: string
          caption?: string | null
          category: string
          filename_stem: string
          package_id: string
          position: number
          subject_id: string
          subject_kind: string
          subject_label: string
          uploaded_at: string
          use_restrictions?: string[]
          venue_id: string
        }
        Update: {
          alt_text?: string | null
          approval_id?: string
          approval_kind?: string
          approval_level?: string
          approval_version?: string
          asset_id?: string
          caption?: string | null
          category?: string
          filename_stem?: string
          package_id?: string
          position?: number
          subject_id?: string
          subject_kind?: string
          subject_label?: string
          uploaded_at?: string
          use_restrictions?: string[]
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_package_items_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "export_package_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "export_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      export_packages: {
        Row: {
          created_at: string
          created_by: string
          id: string
          invalidated_assets: string[] | null
          invalidated_at: string | null
          invalidated_reason: string | null
          item_count: number
          mode: string
          note: string | null
          profile: Json
          profile_key: string
          rebuilt_from: string | null
          request_hash: string
          request_key: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          invalidated_assets?: string[] | null
          invalidated_at?: string | null
          invalidated_reason?: string | null
          item_count: number
          mode: string
          note?: string | null
          profile: Json
          profile_key: string
          rebuilt_from?: string | null
          request_hash: string
          request_key: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          invalidated_assets?: string[] | null
          invalidated_at?: string | null
          invalidated_reason?: string | null
          item_count?: number
          mode?: string
          note?: string | null
          profile?: Json
          profile_key?: string
          rebuilt_from?: string | null
          request_hash?: string
          request_key?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_packages_profile_key_fkey"
            columns: ["profile_key"]
            isOneToOne: false
            referencedRelation: "export_profiles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "export_packages_rebuilt_from_fkey"
            columns: ["rebuilt_from"]
            isOneToOne: false
            referencedRelation: "export_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_packages_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      export_profile_events: {
        Row: {
          changed_at: string
          changed_by: string
          format: string
          id: number
          key: string
          label: string
          max_height: number | null
          max_width: number | null
          quality: number | null
          revision: number
        }
        Insert: {
          changed_at?: string
          changed_by: string
          format: string
          id?: never
          key: string
          label: string
          max_height?: number | null
          max_width?: number | null
          quality?: number | null
          revision: number
        }
        Update: {
          changed_at?: string
          changed_by?: string
          format?: string
          id?: never
          key?: string
          label?: string
          max_height?: number | null
          max_width?: number | null
          quality?: number | null
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "export_profile_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_profile_events_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "export_profiles"
            referencedColumns: ["key"]
          },
        ]
      }
      export_profiles: {
        Row: {
          format: string
          key: string
          label: string
          max_height: number | null
          max_width: number | null
          position: number
          quality: number | null
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          format: string
          key: string
          label: string
          max_height?: number | null
          max_width?: number | null
          position: number
          quality?: number | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          format?: string
          key?: string
          label?: string
          max_height?: number | null
          max_width?: number | null
          position?: number
          quality?: number | null
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_commands: {
        Row: {
          actor_id: string
          command: string
          created_at: string
          idempotency_key: string
          question_key: string
          request_hash: string
          result: Json
          venue_id: string
        }
        Insert: {
          actor_id: string
          command: string
          created_at?: string
          idempotency_key: string
          question_key: string
          request_hash: string
          result: Json
          venue_id: string
        }
        Update: {
          actor_id?: string
          command?: string
          created_at?: string
          idempotency_key?: string
          question_key?: string
          request_hash?: string
          result?: Json
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_commands_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_commands_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_contribution_assets: {
        Row: {
          asset_id: string
          contribution_id: string
          evidence_kind: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          contribution_id: string
          evidence_kind: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          contribution_id?: string
          evidence_kind?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_contribution_assets_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "knowledge_contribution_assets_contribution_fkey"
            columns: ["contribution_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      knowledge_contribution_details: {
        Row: {
          contribution_id: string
          created_at: string
          derived_from_version: number | null
          detail: Json | null
          observed_on: string | null
          observed_on_source: string | null
          question_version: number
          request_hash: string
          value_schema: string
          value_schema_version: number
          venue_id: string
        }
        Insert: {
          contribution_id: string
          created_at?: string
          derived_from_version?: number | null
          detail?: Json | null
          observed_on?: string | null
          observed_on_source?: string | null
          question_version: number
          request_hash: string
          value_schema: string
          value_schema_version: number
          venue_id: string
        }
        Update: {
          contribution_id?: string
          created_at?: string
          derived_from_version?: number | null
          detail?: Json | null
          observed_on?: string | null
          observed_on_source?: string | null
          question_version?: number
          request_hash?: string
          value_schema?: string
          value_schema_version?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_contribution_details_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: true
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contribution_details_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_contribution_sources: {
        Row: {
          assertion_id: string | null
          contribution_id: string
          created_at: string
          legacy_fact_id: string | null
          legacy_revision: number | null
          question_key: string
          run_id: string
          source_kind: string
          source_label: string
          venue_id: string
        }
        Insert: {
          assertion_id?: string | null
          contribution_id: string
          created_at?: string
          legacy_fact_id?: string | null
          legacy_revision?: number | null
          question_key: string
          run_id: string
          source_kind: string
          source_label: string
          venue_id: string
        }
        Update: {
          assertion_id?: string | null
          contribution_id?: string
          created_at?: string
          legacy_fact_id?: string | null
          legacy_revision?: number | null
          question_key?: string
          run_id?: string
          source_kind?: string
          source_label?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_contribution_sources_assertion_id_fkey"
            columns: ["assertion_id"]
            isOneToOne: false
            referencedRelation: "knowledge_source_assertions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contribution_sources_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: true
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contribution_sources_legacy_fact_id_fkey"
            columns: ["legacy_fact_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contribution_sources_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "knowledge_reconciliation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contribution_sources_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_contributions: {
        Row: {
          answer: string
          based_on_slot_revision: number
          based_on_submission_id: string | null
          change_reason: string | null
          check_id: string
          confirm_own: boolean
          contributed_by: string
          contributor_basis: string
          created_at: string
          evidence_rule: string
          finding: string | null
          id: string
          idempotency_key: string
          initial_outcome: string
          internal_metadata: Json | null
          kind: string
          limitations: string | null
          question_key: string
          reason: string | null
          redaction_confirmed: boolean | null
          request_hash: string
          responds_to_decision_id: string | null
          rule_version: number
          template_version: number
          tried_text: string | null
          unknown_preset: string | null
          venue_id: string
        }
        Insert: {
          answer: string
          based_on_slot_revision: number
          based_on_submission_id?: string | null
          change_reason?: string | null
          check_id: string
          confirm_own?: boolean
          contributed_by: string
          contributor_basis: string
          created_at?: string
          evidence_rule: string
          finding?: string | null
          id?: string
          idempotency_key: string
          initial_outcome: string
          internal_metadata?: Json | null
          kind: string
          limitations?: string | null
          question_key: string
          reason?: string | null
          redaction_confirmed?: boolean | null
          request_hash: string
          responds_to_decision_id?: string | null
          rule_version: number
          template_version: number
          tried_text?: string | null
          unknown_preset?: string | null
          venue_id: string
        }
        Update: {
          answer?: string
          based_on_slot_revision?: number
          based_on_submission_id?: string | null
          change_reason?: string | null
          check_id?: string
          confirm_own?: boolean
          contributed_by?: string
          contributor_basis?: string
          created_at?: string
          evidence_rule?: string
          finding?: string | null
          id?: string
          idempotency_key?: string
          initial_outcome?: string
          internal_metadata?: Json | null
          kind?: string
          limitations?: string | null
          question_key?: string
          reason?: string | null
          redaction_confirmed?: boolean | null
          request_hash?: string
          responds_to_decision_id?: string | null
          rule_version?: number
          template_version?: number
          tried_text?: string | null
          unknown_preset?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_contributions_based_on_submission_id_fkey"
            columns: ["based_on_submission_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contributions_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "knowledge_contributions_contributed_by_fkey"
            columns: ["contributed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_contributions_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_contributions_responds_to_fkey"
            columns: ["responds_to_decision_id"]
            isOneToOne: false
            referencedRelation: "knowledge_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_decisions: {
        Row: {
          check_id: string
          contribution_id: string | null
          created_at: string
          decided_by: string | null
          decider_basis: string
          decision: string
          detail: Json | null
          id: string
          note: string | null
          question_key: string
          resulting_submission_id: string | null
          rule_version: number | null
          self_confirmed: boolean
          slot_revision: number | null
          submission_id: string | null
          venue_id: string
        }
        Insert: {
          check_id: string
          contribution_id?: string | null
          created_at?: string
          decided_by?: string | null
          decider_basis: string
          decision: string
          detail?: Json | null
          id?: string
          note?: string | null
          question_key: string
          resulting_submission_id?: string | null
          rule_version?: number | null
          self_confirmed?: boolean
          slot_revision?: number | null
          submission_id?: string | null
          venue_id: string
        }
        Update: {
          check_id?: string
          contribution_id?: string | null
          created_at?: string
          decided_by?: string | null
          decider_basis?: string
          decision?: string
          detail?: Json | null
          id?: string
          note?: string | null
          question_key?: string
          resulting_submission_id?: string | null
          rule_version?: number | null
          self_confirmed?: boolean
          slot_revision?: number | null
          submission_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_decisions_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "knowledge_decisions_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_decisions_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_decisions_resulting_submission_id_fkey"
            columns: ["resulting_submission_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_decisions_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_detail_corrections: {
        Row: {
          contribution_id: string
          created_at: string
          decision_id: string
          detail: Json | null
          id: string
          venue_id: string
        }
        Insert: {
          contribution_id: string
          created_at?: string
          decision_id: string
          detail?: Json | null
          id?: string
          venue_id: string
        }
        Update: {
          contribution_id?: string
          created_at?: string
          decision_id?: string
          detail?: Json | null
          id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_detail_corrections_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_detail_corrections_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "knowledge_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_detail_corrections_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_drafts: {
        Row: {
          asset_ids: string[]
          check_id: string
          draft_revision: number
          idempotency_key: string | null
          payload: Json
          updated_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          asset_ids?: string[]
          check_id: string
          draft_revision: number
          idempotency_key?: string | null
          payload: Json
          updated_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          asset_ids?: string[]
          check_id?: string
          draft_revision?: number
          idempotency_key?: string | null
          payload?: Json
          updated_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_drafts_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "knowledge_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_events: {
        Row: {
          actor_id: string | null
          check_id: string | null
          contribution_id: string | null
          created_at: string
          decision_id: string | null
          detail: Json
          id: number
          kind: string
          question_key: string
          submission_id: string | null
          venue_id: string
        }
        Insert: {
          actor_id?: string | null
          check_id?: string | null
          contribution_id?: string | null
          created_at?: string
          decision_id?: string | null
          detail?: Json
          id?: never
          kind: string
          question_key: string
          submission_id?: string | null
          venue_id: string
        }
        Update: {
          actor_id?: string | null
          check_id?: string | null
          contribution_id?: string | null
          created_at?: string
          decision_id?: string | null
          detail?: Json
          id?: never
          kind?: string
          question_key?: string
          submission_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_events_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_external_sources: {
        Row: {
          declared_at: string
          declared_by: string
          id: string
          kind: string
          label: string
          retire_reason: string | null
          retired_at: string | null
          retired_by: string | null
          venue_id: string | null
        }
        Insert: {
          declared_at?: string
          declared_by: string
          id?: string
          kind: string
          label: string
          retire_reason?: string | null
          retired_at?: string | null
          retired_by?: string | null
          venue_id?: string | null
        }
        Update: {
          declared_at?: string
          declared_by?: string
          id?: string
          kind?: string
          label?: string
          retire_reason?: string | null
          retired_at?: string | null
          retired_by?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_external_sources_declared_by_fkey"
            columns: ["declared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_external_sources_retired_by_fkey"
            columns: ["retired_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_external_sources_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_fact_checks: {
        Row: {
          check_id: string
          checked_on: string | null
          created_at: string
          decided_by: string
          decider_basis: string
          id: string
          kind: string
          next_check_on: string | null
          note: string | null
          question_key: string
          slot_revision: number
          submission_id: string
          venue_id: string
        }
        Insert: {
          check_id: string
          checked_on?: string | null
          created_at?: string
          decided_by: string
          decider_basis: string
          id?: string
          kind: string
          next_check_on?: string | null
          note?: string | null
          question_key: string
          slot_revision: number
          submission_id: string
          venue_id: string
        }
        Update: {
          check_id?: string
          checked_on?: string | null
          created_at?: string
          decided_by?: string
          decider_basis?: string
          id?: string
          kind?: string
          next_check_on?: string | null
          note?: string | null
          question_key?: string
          slot_revision?: number
          submission_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_fact_checks_check_fkey"
            columns: ["check_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "knowledge_fact_checks_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_fact_checks_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_fact_checks_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_freshness_policies: {
        Row: {
          basis: string
          claim_class: string
          created_at: string
          created_by: string | null
          id: string
          max_age: string | null
          note: string | null
          recheck_lead: string | null
          use: string
          version: number
        }
        Insert: {
          basis: string
          claim_class: string
          created_at?: string
          created_by?: string | null
          id: string
          max_age?: string | null
          note?: string | null
          recheck_lead?: string | null
          use: string
          version: number
        }
        Update: {
          basis?: string
          claim_class?: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_age?: string | null
          note?: string | null
          recheck_lead?: string | null
          use?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_freshness_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_legacy_mappings: {
        Row: {
          id: string
          legacy_fact_id: string
          legacy_revision: number
          mapping_kind: string
          question_key: string
          reason: string
          reviewed_at: string
          reviewed_by: string
        }
        Insert: {
          id?: string
          legacy_fact_id: string
          legacy_revision: number
          mapping_kind: string
          question_key: string
          reason: string
          reviewed_at?: string
          reviewed_by: string
        }
        Update: {
          id?: string
          legacy_fact_id?: string
          legacy_revision?: number
          mapping_kind?: string
          question_key?: string
          reason?: string
          reviewed_at?: string
          reviewed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_legacy_mappings_legacy_fact_id_fkey"
            columns: ["legacy_fact_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_legacy_mappings_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_legacy_mappings_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_outcome_dismissals: {
        Row: {
          dismissed_at: string
          event_id: number
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          event_id: number
          user_id: string
        }
        Update: {
          dismissed_at?: string
          event_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_outcome_dismissals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "knowledge_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_outcome_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_question_rules: {
        Row: {
          confirmation: string
          created_at: string
          question_key: string
          redaction_required: boolean
          rule_version: number
          self_confirmation_allowed: boolean
          staff_text_internal: boolean
          unassigned_auto_complete: boolean
        }
        Insert: {
          confirmation: string
          created_at?: string
          question_key: string
          redaction_required?: boolean
          rule_version: number
          self_confirmation_allowed?: boolean
          staff_text_internal?: boolean
          unassigned_auto_complete?: boolean
        }
        Update: {
          confirmation?: string
          created_at?: string
          question_key?: string
          redaction_required?: boolean
          rule_version?: number
          self_confirmation_allowed?: boolean
          staff_text_internal?: boolean
          unassigned_auto_complete?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_question_rules_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
        ]
      }
      knowledge_question_versions: {
        Row: {
          catalogue_version: number
          change_kind: string
          change_note: string | null
          confirmation: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          evidence_rule: string
          family: string
          features: Json
          freshness: Json
          guidance: Json
          key: string
          lifecycle: string
          material_fields: string[]
          owner_role: string
          public_media: string
          publishable_fields: string[]
          requires_zones: boolean
          rule_version: number | null
          self_confirmation_allowed: boolean
          sensitivity: string
          subject_type: string
          superseded_by: string[] | null
          upgrade_rules: Json
          value_schema: string
          value_schema_version: number
          version: number
        }
        Insert: {
          catalogue_version: number
          change_kind: string
          change_note?: string | null
          confirmation: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          evidence_rule: string
          family: string
          features?: Json
          freshness?: Json
          guidance: Json
          key: string
          lifecycle: string
          material_fields?: string[]
          owner_role: string
          public_media?: string
          publishable_fields?: string[]
          requires_zones?: boolean
          rule_version?: number | null
          self_confirmation_allowed?: boolean
          sensitivity: string
          subject_type: string
          superseded_by?: string[] | null
          upgrade_rules?: Json
          value_schema: string
          value_schema_version: number
          version: number
        }
        Update: {
          catalogue_version?: number
          change_kind?: string
          change_note?: string | null
          confirmation?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          evidence_rule?: string
          family?: string
          features?: Json
          freshness?: Json
          guidance?: Json
          key?: string
          lifecycle?: string
          material_fields?: string[]
          owner_role?: string
          public_media?: string
          publishable_fields?: string[]
          requires_zones?: boolean
          rule_version?: number | null
          self_confirmation_allowed?: boolean
          sensitivity?: string
          subject_type?: string
          superseded_by?: string[] | null
          upgrade_rules?: Json
          value_schema?: string
          value_schema_version?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_question_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_question_versions_key_fkey"
            columns: ["key"]
            isOneToOne: false
            referencedRelation: "knowledge_questions"
            referencedColumns: ["key"]
          },
        ]
      }
      knowledge_questions: {
        Row: {
          created_at: string
          created_by: string | null
          key: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          key: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          key?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_questions_key_fkey"
            columns: ["key"]
            isOneToOne: true
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
        ]
      }
      knowledge_recheck_tasks: {
        Row: {
          cause: string
          check_id: string
          closed_at: string | null
          closed_by: string | null
          closed_decision_id: string | null
          created_at: string
          due_at: string
          id: string
          question_key: string
          state: string
          use: string
          venue_id: string
        }
        Insert: {
          cause: string
          check_id: string
          closed_at?: string | null
          closed_by?: string | null
          closed_decision_id?: string | null
          created_at?: string
          due_at: string
          id?: string
          question_key: string
          state?: string
          use: string
          venue_id: string
        }
        Update: {
          cause?: string
          check_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_decision_id?: string | null
          created_at?: string
          due_at?: string
          id?: string
          question_key?: string
          state?: string
          use?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_recheck_tasks_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_recheck_tasks_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_recheck_tasks_closed_decision_id_fkey"
            columns: ["closed_decision_id"]
            isOneToOne: false
            referencedRelation: "knowledge_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_recheck_tasks_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_reconciliation_runs: {
        Row: {
          conflicts: Json
          counts: Json
          dry_run_id: string | null
          finished_at: string
          id: string
          kind: string
          mode: string
          source_revisions: Json
          started_at: string
          started_by: string
          venue_id: string | null
          would_create: Json
        }
        Insert: {
          conflicts?: Json
          counts: Json
          dry_run_id?: string | null
          finished_at?: string
          id?: string
          kind: string
          mode: string
          source_revisions: Json
          started_at?: string
          started_by: string
          venue_id?: string | null
          would_create?: Json
        }
        Update: {
          conflicts?: Json
          counts?: Json
          dry_run_id?: string | null
          finished_at?: string
          id?: string
          kind?: string
          mode?: string
          source_revisions?: Json
          started_at?: string
          started_by?: string
          venue_id?: string | null
          would_create?: Json
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_reconciliation_runs_dry_run_id_fkey"
            columns: ["dry_run_id"]
            isOneToOne: false
            referencedRelation: "knowledge_reconciliation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_reconciliation_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_reconciliation_runs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_schedule_exceptions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          local_date: string
          note: string | null
          schedule_id: string
          venue_id: string
          windows: Json | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: string
          local_date: string
          note?: string | null
          schedule_id: string
          venue_id: string
          windows?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          local_date?: string
          note?: string | null
          schedule_id?: string
          venue_id?: string
          windows?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_schedule_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedule_exceptions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "knowledge_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedule_exceptions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_schedules: {
        Row: {
          check_id: string
          contribution_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          question_key: string
          recurrence: Json
          submission_id: string | null
          supersedes: string | null
          timezone: string
          venue_id: string
          windows: Json
        }
        Insert: {
          check_id: string
          contribution_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          question_key: string
          recurrence: Json
          submission_id?: string | null
          supersedes?: string | null
          timezone: string
          venue_id: string
          windows: Json
        }
        Update: {
          check_id?: string
          contribution_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          question_key?: string
          recurrence?: Json
          submission_id?: string | null
          supersedes?: string | null
          timezone?: string
          venue_id?: string
          windows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_schedules_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "venue_amenity_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedules_contribution_id_fkey"
            columns: ["contribution_id"]
            isOneToOne: false
            referencedRelation: "knowledge_contributions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedules_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedules_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "knowledge_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_schedules_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_source_assertions: {
        Row: {
          created_at: string
          created_by: string
          detail: Json | null
          excerpt: string | null
          headline: string
          id: string
          question_key: string
          retrieved_at: string
          source_id: string
          source_revision: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          detail?: Json | null
          excerpt?: string | null
          headline: string
          id?: string
          question_key: string
          retrieved_at: string
          source_id: string
          source_revision: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          detail?: Json | null
          excerpt?: string | null
          headline?: string
          id?: string
          question_key?: string
          retrieved_at?: string
          source_id?: string
          source_revision?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_source_assertions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_source_assertions_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_source_assertions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_external_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_source_assertions_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_subjects: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          label: string
          retire_reason: string | null
          retired_at: string | null
          retired_by: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: string
          label: string
          retire_reason?: string | null
          retired_at?: string | null
          retired_by?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          label?: string
          retire_reason?: string | null
          retired_at?: string | null
          retired_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_subjects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_subjects_retired_by_fkey"
            columns: ["retired_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_subjects_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_value_list_items: {
        Row: {
          code: string
          created_at: string
          label: string
          list: string
          needs_value: boolean
          position: number
          retired_at: string | null
          value_kind: string | null
        }
        Insert: {
          code: string
          created_at?: string
          label: string
          list: string
          needs_value?: boolean
          position?: number
          retired_at?: string | null
          value_kind?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          label?: string
          list?: string
          needs_value?: boolean
          position?: number
          retired_at?: string | null
          value_kind?: string | null
        }
        Relationships: []
      }
      knowledge_working_list: {
        Row: {
          disabled_at: string | null
          disabled_by: string | null
          enabled_at: string
          enabled_by: string | null
          id: string
          question_key: string
          reason: string | null
          venue_id: string
        }
        Insert: {
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string
          enabled_by?: string | null
          id?: string
          question_key: string
          reason?: string | null
          venue_id: string
        }
        Update: {
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string
          enabled_by?: string | null
          id?: string
          question_key?: string
          reason?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_working_list_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_working_list_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_working_list_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "knowledge_working_list_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_write_commands: {
        Row: {
          actor_id: string
          command: string
          created_at: string
          idempotency_key: string
          request_hash: string
          result: Json
          venue_id: string | null
        }
        Insert: {
          actor_id: string
          command: string
          created_at?: string
          idempotency_key: string
          request_hash: string
          result: Json
          venue_id?: string | null
        }
        Update: {
          actor_id?: string
          command?: string
          created_at?: string
          idempotency_key?: string
          request_hash?: string
          result?: Json
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_write_commands_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_write_commands_venue_id_fkey"
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
      media_area_labels: {
        Row: {
          added_at: string
          added_by: string
          asset_id: string
          id: string
          removed_at: string | null
          removed_by: string | null
          subject_id: string
          subject_kind: string
          subject_label: string
          venue_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          asset_id: string
          id?: string
          removed_at?: string | null
          removed_by?: string | null
          subject_id: string
          subject_kind: string
          subject_label: string
          venue_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          asset_id?: string
          id?: string
          removed_at?: string | null
          removed_by?: string | null
          subject_id?: string
          subject_kind?: string
          subject_label?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_area_labels_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_area_labels_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_area_labels_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_area_labels_subject_fkey"
            columns: ["subject_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "knowledge_subjects"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      media_asset_links: {
        Row: {
          asset_id: string
          created_at: string
          created_by: string
          group_id: string | null
          kind: string
          related_asset_id: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          created_by: string
          group_id?: string | null
          kind: string
          related_asset_id: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          created_by?: string
          group_id?: string | null
          kind?: string
          related_asset_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_asset_links_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_asset_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_asset_links_group_fkey"
            columns: ["group_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_contribution_groups"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_asset_links_related_fkey"
            columns: ["related_asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      media_assets: {
        Row: {
          captured_at: string | null
          captured_at_set_by: string | null
          captured_at_source: string
          client_batch_id: string | null
          client_upload_key: string | null
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          duplicate_of_asset_id: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path: string | null
          purpose: string
          size_bytes: number | null
          thumbnail_path: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          uploader_role: Database["public"]["Enums"]["app_role"] | null
          use_baseline: string
          validated_mime_type: string | null
          venue_id: string
          width: number | null
        }
        Insert: {
          captured_at?: string | null
          captured_at_set_by?: string | null
          captured_at_source?: string
          client_batch_id?: string | null
          client_upload_key?: string | null
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          duplicate_of_asset_id?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path?: string | null
          purpose?: string
          size_bytes?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          uploader_role?: Database["public"]["Enums"]["app_role"] | null
          use_baseline?: string
          validated_mime_type?: string | null
          venue_id: string
          width?: number | null
        }
        Update: {
          captured_at?: string | null
          captured_at_set_by?: string | null
          captured_at_source?: string
          client_batch_id?: string | null
          client_upload_key?: string | null
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          duplicate_of_asset_id?: string | null
          duration_seconds?: number | null
          height?: number | null
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          original_filename?: string
          original_path?: string
          preview_path?: string | null
          purpose?: string
          size_bytes?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["upload_state"]
          uploader_id?: string
          uploader_role?: Database["public"]["Enums"]["app_role"] | null
          use_baseline?: string
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
      media_contribution_group_members: {
        Row: {
          added_at: string
          asset_id: string
          group_id: string
          position: number
          venue_id: string
        }
        Insert: {
          added_at?: string
          asset_id: string
          group_id: string
          position: number
          venue_id: string
        }
        Update: {
          added_at?: string
          asset_id?: string
          group_id?: string
          position?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_contribution_group_members_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_contribution_group_members_group_fkey"
            columns: ["group_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_contribution_groups"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      media_contribution_groups: {
        Row: {
          client_group_key: string
          created_at: string
          created_by: string
          id: string
          subject_id: string | null
          subject_kind: string
          venue_id: string
        }
        Insert: {
          client_group_key: string
          created_at?: string
          created_by: string
          id?: string
          subject_id?: string | null
          subject_kind: string
          venue_id: string
        }
        Update: {
          client_group_key?: string
          created_at?: string
          created_by?: string
          id?: string
          subject_id?: string | null
          subject_kind?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_contribution_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_contribution_groups_venue_id_fkey"
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
      media_pending_labels: {
        Row: {
          asset_id: string
          catalogue_version_id: string | null
          code: string | null
          created_at: string
          input: Json
          message: string | null
          status: string
          updated_at: string
          uploader_id: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          catalogue_version_id?: string | null
          code?: string | null
          created_at?: string
          input: Json
          message?: string | null
          status?: string
          updated_at?: string
          uploader_id: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          catalogue_version_id?: string | null
          code?: string | null
          created_at?: string
          input?: Json
          message?: string | null
          status?: string
          updated_at?: string
          uploader_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_pending_labels_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_pending_labels_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_removal_events: {
        Row: {
          action: string
          actor_id: string
          asset_id: string
          created_at: string
          id: number
          impact: Json | null
          reason: string | null
          request_id: string | null
          venue_id: string
        }
        Insert: {
          action: string
          actor_id: string
          asset_id: string
          created_at?: string
          id?: never
          impact?: Json | null
          reason?: string | null
          request_id?: string | null
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          asset_id?: string
          created_at?: string
          id?: never
          impact?: Json | null
          reason?: string | null
          request_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_removal_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_removal_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "media_removal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_removal_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      media_removal_requests: {
        Row: {
          asset_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          id: string
          reason: string
          requested_by: string
          state: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          reason: string
          requested_by: string
          state?: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          id?: string
          reason?: string
          requested_by?: string
          state?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_removal_requests_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_removal_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_removal_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_renditions: {
        Row: {
          asset_id: string
          created_at: string
          height: number | null
          kind: string
          mime_type: string
          object_key: string
          pipeline_version: string
          settings: Json
          width: number | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          height?: number | null
          kind: string
          mime_type: string
          object_key: string
          pipeline_version: string
          settings?: Json
          width?: number | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          height?: number | null
          kind?: string
          mime_type?: string
          object_key?: string
          pipeline_version?: string
          settings?: Json
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_renditions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_use_destinations: {
        Row: {
          active: boolean
          audience: string
          created_at: string
          key: string
          label: string
          owner_workstream: string
          requires_derivative: boolean
          venue_id: string | null
        }
        Insert: {
          active?: boolean
          audience: string
          created_at?: string
          key: string
          label: string
          owner_workstream: string
          requires_derivative: boolean
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          audience?: string
          created_at?: string
          key?: string
          label?: string
          owner_workstream?: string
          requires_derivative?: boolean
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_use_destinations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      media_use_grant_withdrawals: {
        Row: {
          grant_id: string
          internal_note: string | null
          reason_code: string
          request_key: string | null
          withdrawn_at: string
          withdrawn_by: string | null
        }
        Insert: {
          grant_id: string
          internal_note?: string | null
          reason_code: string
          request_key?: string | null
          withdrawn_at?: string
          withdrawn_by?: string | null
        }
        Update: {
          grant_id?: string
          internal_note?: string | null
          reason_code?: string
          request_key?: string | null
          withdrawn_at?: string
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_use_grant_withdrawals_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: true
            referencedRelation: "media_use_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_use_grant_withdrawals_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_use_granters: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          profile_id: string
          revoked_at: string | null
          venue_id: string | null
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          profile_id: string
          revoked_at?: string | null
          venue_id?: string | null
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          profile_id?: string
          revoked_at?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_use_granters_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_use_granters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_use_granters_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      media_use_grants: {
        Row: {
          asset_id: string
          audience: string
          authorised_by: string
          authority_basis: string
          clearance: Json
          clearance_version: string
          created_at: string
          derivative_profile_key: string | null
          destination_key: string
          effective_from: string
          effective_until: string | null
          id: string
          internal_note: string | null
          purpose: string
          request_key: string
          reused_from_grant_id: string | null
          subject_id: string | null
          subject_key: string | null
          subject_kind: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          audience: string
          authorised_by: string
          authority_basis: string
          clearance: Json
          clearance_version: string
          created_at?: string
          derivative_profile_key?: string | null
          destination_key: string
          effective_from: string
          effective_until?: string | null
          id?: string
          internal_note?: string | null
          purpose: string
          request_key: string
          reused_from_grant_id?: string | null
          subject_id?: string | null
          subject_key?: string | null
          subject_kind: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          audience?: string
          authorised_by?: string
          authority_basis?: string
          clearance?: Json
          clearance_version?: string
          created_at?: string
          derivative_profile_key?: string | null
          destination_key?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          internal_note?: string | null
          purpose?: string
          request_key?: string
          reused_from_grant_id?: string | null
          subject_id?: string | null
          subject_key?: string | null
          subject_kind?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_use_grants_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "media_use_grants_authorised_by_fkey"
            columns: ["authorised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_use_grants_destination_key_fkey"
            columns: ["destination_key"]
            isOneToOne: false
            referencedRelation: "media_use_destinations"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "media_use_grants_reused_fkey"
            columns: ["reused_from_grant_id", "asset_id"]
            isOneToOne: false
            referencedRelation: "media_use_grants"
            referencedColumns: ["id", "asset_id"]
          },
        ]
      }
      media_use_withdraw_requests: {
        Row: {
          command: string
          created_at: string
          internal_note: string | null
          reason_code: string
          request_key: string
          requested_by: string
          target_id: string
        }
        Insert: {
          command: string
          created_at?: string
          internal_note?: string | null
          reason_code: string
          request_key: string
          requested_by: string
          target_id: string
        }
        Update: {
          command?: string
          created_at?: string
          internal_note?: string | null
          reason_code?: string
          request_key?: string
          requested_by?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_use_withdraw_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_change_requests: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          detail: string
          id: string
          item_id: string | null
          kind: string
          requested_at: string
          requested_by: string
          revision: number
          status: string
          venue_id: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          detail: string
          id?: string
          item_id?: string | null
          kind: string
          requested_at?: string
          requested_by: string
          revision?: number
          status?: string
          venue_id: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          detail?: string
          id?: string
          item_id?: string | null
          kind?: string
          requested_at?: string
          requested_by?: string
          revision?: number
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_change_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_change_requests_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_change_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_change_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
      menu_item_availability: {
        Row: {
          item_id: string
          reason: string
          set_at: string
          set_by: string
          until_on: string | null
          venue_id: string
        }
        Insert: {
          item_id: string
          reason: string
          set_at?: string
          set_by: string
          until_on?: string | null
          venue_id: string
        }
        Update: {
          item_id?: string
          reason?: string
          set_at?: string
          set_by?: string
          until_on?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_availability_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_availability_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_display_names: {
        Row: {
          display_name: string
          item_id: string
          reason: string
          set_at: string
          set_by: string
          venue_id: string
        }
        Insert: {
          display_name: string
          item_id: string
          reason: string
          set_at?: string
          set_by: string
          venue_id: string
        }
        Update: {
          display_name?: string
          item_id?: string
          reason?: string
          set_at?: string
          set_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_display_names_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_display_names_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_needed_by: {
        Row: {
          cleared_at: string | null
          cleared_by: string | null
          cleared_by_role: string | null
          item_id: string
          needed_by: string
          set_at: string
          set_by: string
          set_by_role: string
          venue_id: string
        }
        Insert: {
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_role?: string | null
          item_id: string
          needed_by: string
          set_at?: string
          set_by: string
          set_by_role: string
          venue_id: string
        }
        Update: {
          cleared_at?: string | null
          cleared_by?: string | null
          cleared_by_role?: string | null
          item_id?: string
          needed_by?: string
          set_at?: string
          set_by?: string
          set_by_role?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_needed_by_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_needed_by_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: true
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_needed_by_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_needed_by_events: {
        Row: {
          action: string
          actor_id: string
          actor_role: string
          created_at: string
          id: number
          item_id: string
          needed_by: string | null
          venue_id: string
        }
        Insert: {
          action: string
          actor_id: string
          actor_role: string
          created_at?: string
          id?: never
          item_id: string
          needed_by?: string | null
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          actor_role?: string
          created_at?: string
          id?: never
          item_id?: string
          needed_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_needed_by_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_needed_by_events_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      menu_item_photo_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          asset_id: string
          author_id: string
          client_request_key: string | null
          created_at: string
          detail: Json
          from_state: string | null
          id: number
          item_id: string
          item_revision: number
          photo_id: string
          reason: string | null
          revision: number
          self_review: boolean
          to_state: string
          variant_id: string | null
          venue_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          asset_id: string
          author_id: string
          client_request_key?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: never
          item_id: string
          item_revision: number
          photo_id: string
          reason?: string | null
          revision: number
          self_review?: boolean
          to_state: string
          variant_id?: string | null
          venue_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          asset_id?: string
          author_id?: string
          client_request_key?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: never
          item_id?: string
          item_revision?: number
          photo_id?: string
          reason?: string | null
          revision?: number
          self_review?: boolean
          to_state?: string
          variant_id?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_photo_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photo_events_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photo_events_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "menu_item_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photo_events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_photo_heads: {
        Row: {
          item_id: string
          revision: number
          updated_at: string
          venue_id: string
        }
        Insert: {
          item_id: string
          revision?: number
          updated_at?: string
          venue_id: string
        }
        Update: {
          item_id?: string
          revision?: number
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_photo_heads_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
        ]
      }
      menu_item_photos: {
        Row: {
          asset_id: string
          author_id: string
          basis: string
          corrects_item_id: string | null
          corrects_variant_id: string | null
          created_at: string
          decided_at: string
          decided_by: string
          id: string
          invalidation_kind: string | null
          is_primary: boolean
          item_id: string
          item_name: string
          menu_version_id: string
          reason: string | null
          recheck_kind: string | null
          review_level: string
          revision: number
          section_kind: string
          section_name: string
          self_review: boolean
          state: string
          updated_at: string
          variant_id: string | null
          variant_name: string | null
          venue_id: string
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          asset_id: string
          author_id: string
          basis?: string
          corrects_item_id?: string | null
          corrects_variant_id?: string | null
          created_at?: string
          decided_at?: string
          decided_by: string
          id?: string
          invalidation_kind?: string | null
          is_primary?: boolean
          item_id: string
          item_name: string
          menu_version_id: string
          reason?: string | null
          recheck_kind?: string | null
          review_level?: string
          revision?: number
          section_kind: string
          section_name: string
          self_review: boolean
          state: string
          updated_at?: string
          variant_id?: string | null
          variant_name?: string | null
          venue_id: string
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          asset_id?: string
          author_id?: string
          basis?: string
          corrects_item_id?: string | null
          corrects_variant_id?: string | null
          created_at?: string
          decided_at?: string
          decided_by?: string
          id?: string
          invalidation_kind?: string | null
          is_primary?: boolean
          item_id?: string
          item_name?: string
          menu_version_id?: string
          reason?: string | null
          recheck_kind?: string | null
          review_level?: string
          revision?: number
          section_kind?: string
          section_name?: string
          self_review?: boolean
          state?: string
          updated_at?: string
          variant_id?: string | null
          variant_name?: string | null
          venue_id?: string
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_photos_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_photos_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photos_corrects_item_fkey"
            columns: ["corrects_item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_photos_corrects_variant_fkey"
            columns: ["corrects_variant_id", "corrects_item_id"]
            isOneToOne: false
            referencedRelation: "menu_variants"
            referencedColumns: ["id", "item_id"]
          },
          {
            foreignKeyName: "menu_item_photos_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photos_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_photos_variant_fkey"
            columns: ["variant_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_variants"
            referencedColumns: ["id", "item_id"]
          },
          {
            foreignKeyName: "menu_item_photos_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_photos_version_fkey"
            columns: ["menu_version_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_versions"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_item_photos_withdrawn_by_fkey"
            columns: ["withdrawn_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_presentations: {
        Row: {
          changed_at: string
          changed_by: string
          item_id: string
          note: string
          revision: number
          venue_id: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          item_id: string
          note: string
          revision: number
          venue_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          item_id?: string
          note?: string
          revision?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_presentations_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_presentations_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
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
      menu_specials: {
        Row: {
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          description: string | null
          ended_at: string | null
          ended_by: string | null
          ends_on: string
          id: string
          item_id: string
          kind: string
          name: string
          revision: number
          starts_on: string
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ends_on: string
          id?: string
          item_id: string
          kind: string
          name: string
          revision?: number
          starts_on: string
          status: string
          venue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          description?: string | null
          ended_at?: string | null
          ended_by?: string | null
          ends_on?: string
          id?: string
          item_id?: string
          kind?: string
          name?: string
          revision?: number
          starts_on?: string
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_specials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_specials_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_specials_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_specials_item_fkey"
            columns: ["item_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "menu_specials_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
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
          scheduled_by: string | null
          scheduled_for: string | null
          scheduled_retirements: number | null
          scheduled_revision: number | null
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
          scheduled_by?: string | null
          scheduled_for?: string | null
          scheduled_retirements?: number | null
          scheduled_revision?: number | null
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
          scheduled_by?: string | null
          scheduled_for?: string | null
          scheduled_retirements?: number | null
          scheduled_revision?: number | null
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
            foreignKeyName: "menu_versions_scheduled_by_fkey"
            columns: ["scheduled_by"]
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
      notification_preferences: {
        Row: {
          assignments: boolean
          digests: boolean
          profile_id: string
          quiet_end: string | null
          quiet_start: string | null
          retakes: boolean
          updated_at: string
          upload_problems: boolean
        }
        Insert: {
          assignments?: boolean
          digests?: boolean
          profile_id: string
          quiet_end?: string | null
          quiet_start?: string | null
          retakes?: boolean
          updated_at?: string
          upload_problems?: boolean
        }
        Update: {
          assignments?: boolean
          digests?: boolean
          profile_id?: string
          quiet_end?: string | null
          quiet_start?: string | null
          retakes?: boolean
          updated_at?: string
          upload_problems?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          deliver_after: string
          id: number
          kind: string
          last_attempt_at: string | null
          payload: Json
          read_at: string | null
          recipient_id: string
          resolved_at: string | null
          subject_id: string | null
          subject_type: string
          venue_id: string | null
          version: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          deliver_after?: string
          id?: never
          kind: string
          last_attempt_at?: string | null
          payload?: Json
          read_at?: string | null
          recipient_id: string
          resolved_at?: string | null
          subject_id?: string | null
          subject_type: string
          venue_id?: string | null
          version?: number
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          deliver_after?: string
          id?: never
          kind?: string
          last_attempt_at?: string | null
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          resolved_at?: string | null
          subject_id?: string | null
          subject_type?: string
          venue_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_job_runs: {
        Row: {
          actor_id: string | null
          attempts: number
          detail: Json
          error_code: string | null
          finished_at: string | null
          id: string
          job: string
          started_at: string
          state: string
          subject_id: string | null
          venue_id: string | null
          version: number
        }
        Insert: {
          actor_id?: string | null
          attempts?: number
          detail?: Json
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job: string
          started_at?: string
          state: string
          subject_id?: string | null
          venue_id?: string | null
          version?: number
        }
        Update: {
          actor_id?: string | null
          attempts?: number
          detail?: Json
          error_code?: string | null
          finished_at?: string | null
          id?: string
          job?: string
          started_at?: string
          state?: string
          subject_id?: string | null
          venue_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ops_job_runs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_job_runs_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_settings: {
        Row: {
          backlog_alert_days: number
          export_profiles: string[]
          id: boolean
          orphan_cleanup_days: number
          quiet_end: string
          quiet_start: string
          review_reminder_days: number
          revision: number
          storage_alert_percent: number
          storage_quota_bytes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backlog_alert_days?: number
          export_profiles?: string[]
          id?: boolean
          orphan_cleanup_days?: number
          quiet_end?: string
          quiet_start?: string
          review_reminder_days?: number
          revision?: number
          storage_alert_percent?: number
          storage_quota_bytes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backlog_alert_days?: number
          export_profiles?: string[]
          id?: boolean
          orphan_cleanup_days?: number
          quiet_end?: string
          quiet_start?: string
          review_reminder_days?: number
          revision?: number
          storage_alert_percent?: number
          storage_quota_bytes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      publication_destination_events: {
        Row: {
          active: boolean
          changed_at: string
          changed_by: string
          destination_id: string
          id: number
          label: string
          revision: number
          url: string | null
          venue_id: string | null
        }
        Insert: {
          active: boolean
          changed_at?: string
          changed_by: string
          destination_id: string
          id?: never
          label: string
          revision: number
          url?: string | null
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          changed_at?: string
          changed_by?: string
          destination_id?: string
          id?: never
          label?: string
          revision?: number
          url?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publication_destination_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publication_destination_events_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "publication_destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      publication_destinations: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          kind: string
          label: string
          revision: number
          updated_at: string
          updated_by: string
          url: string | null
          venue_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          kind?: string
          label: string
          revision?: number
          updated_at?: string
          updated_by: string
          url?: string | null
          venue_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          label?: string
          revision?: number
          updated_at?: string
          updated_by?: string
          url?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publication_destinations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publication_destinations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publication_destinations_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      publication_events: {
        Row: {
          action: string
          approval_id: string | null
          asset_id: string
          destination_id: string
          external_ref: string | null
          external_url: string | null
          generation: number
          id: number
          note: string | null
          occurred_on: string
          package_id: string | null
          recorded_at: string
          recorded_by: string
          request_hash: string
          request_key: string
          subject_id: string
          subject_kind: string
          subject_label: string
          venue_id: string
        }
        Insert: {
          action: string
          approval_id?: string | null
          asset_id: string
          destination_id: string
          external_ref?: string | null
          external_url?: string | null
          generation: number
          id?: never
          note?: string | null
          occurred_on: string
          package_id?: string | null
          recorded_at?: string
          recorded_by: string
          request_hash: string
          request_key: string
          subject_id: string
          subject_kind: string
          subject_label: string
          venue_id: string
        }
        Update: {
          action?: string
          approval_id?: string | null
          asset_id?: string
          destination_id?: string
          external_ref?: string | null
          external_url?: string | null
          generation?: number
          id?: never
          note?: string | null
          occurred_on?: string
          package_id?: string | null
          recorded_at?: string
          recorded_by?: string
          request_hash?: string
          request_key?: string
          subject_id?: string
          subject_kind?: string
          subject_label?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publication_events_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "publication_events_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "publication_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publication_events_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "export_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publication_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retake_note_set_asides: {
        Row: {
          id: string
          photo_id: string | null
          photo_revision: number | null
          set_aside_at: string
          staff_id: string
          submission_item_id: string | null
        }
        Insert: {
          id?: string
          photo_id?: string | null
          photo_revision?: number | null
          set_aside_at?: string
          staff_id: string
          submission_item_id?: string | null
        }
        Update: {
          id?: string
          photo_id?: string | null
          photo_revision?: number | null
          set_aside_at?: string
          staff_id?: string
          submission_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retake_note_set_asides_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "menu_item_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retake_note_set_asides_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retake_note_set_asides_submission_item_id_fkey"
            columns: ["submission_item_id"]
            isOneToOne: true
            referencedRelation: "coverage_submission_items"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_primary_choices: {
        Row: {
          asset_id: string
          chosen_at: string
          chosen_by: string
          id: number
          previous_asset_id: string | null
          reason: string | null
          slot_id: string
          slot_kind: string
          use: string
          venue_id: string
        }
        Insert: {
          asset_id: string
          chosen_at?: string
          chosen_by: string
          id?: never
          previous_asset_id?: string | null
          reason?: string | null
          slot_id: string
          slot_kind: string
          use?: string
          venue_id: string
        }
        Update: {
          asset_id?: string
          chosen_at?: string
          chosen_by?: string
          id?: never
          previous_asset_id?: string | null
          reason?: string | null
          slot_id?: string
          slot_kind?: string
          use?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_primary_choices_asset_fkey"
            columns: ["asset_id", "venue_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id", "venue_id"]
          },
          {
            foreignKeyName: "slot_primary_choices_chosen_by_fkey"
            columns: ["chosen_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_primary_choices_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_work_profiles: {
        Row: {
          completed_at: string | null
          created_at: string
          role_key: string | null
          role_title: string | null
          skipped_at: string | null
          staff_id: string
          updated_at: string
          welcome_dismissed_at: string | null
          work_areas: string[]
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          role_key?: string | null
          role_title?: string | null
          skipped_at?: string | null
          staff_id: string
          updated_at?: string
          welcome_dismissed_at?: string | null
          work_areas?: string[]
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          role_key?: string | null
          role_title?: string | null
          skipped_at?: string | null
          staff_id?: string
          updated_at?: string
          welcome_dismissed_at?: string | null
          work_areas?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "staff_work_profiles_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_amenity_checks: {
        Row: {
          answer: string
          answered_at: string | null
          answered_by: string | null
          assignee_user_id: string | null
          created_at: string
          created_by: string | null
          current_submission_id: string | null
          id: string
          notes: string | null
          progress: string
          recheck_reason: string | null
          revision: number
          status: string
          template_key: string
          updated_at: string
          venue_id: string
        }
        Insert: {
          answer?: string
          answered_at?: string | null
          answered_by?: string | null
          assignee_user_id?: string | null
          created_at?: string
          created_by?: string | null
          current_submission_id?: string | null
          id?: string
          notes?: string | null
          progress?: string
          recheck_reason?: string | null
          revision?: number
          status?: string
          template_key: string
          updated_at?: string
          venue_id: string
        }
        Update: {
          answer?: string
          answered_at?: string | null
          answered_by?: string | null
          assignee_user_id?: string | null
          created_at?: string
          created_by?: string | null
          current_submission_id?: string | null
          id?: string
          notes?: string | null
          progress?: string
          recheck_reason?: string | null
          revision?: number
          status?: string
          template_key?: string
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_amenity_checks_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_checks_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_checks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_checks_current_submission_fkey"
            columns: ["current_submission_id", "id"]
            isOneToOne: false
            referencedRelation: "amenity_submissions"
            referencedColumns: ["id", "check_id"]
          },
          {
            foreignKeyName: "venue_amenity_checks_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "amenity_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "venue_amenity_checks_venue_id_fkey"
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
      venue_amenity_settings: {
        Row: {
          enabled_at: string
          enabled_by: string | null
          venue_id: string
        }
        Insert: {
          enabled_at?: string
          enabled_by?: string | null
          venue_id: string
        }
        Update: {
          enabled_at?: string
          enabled_by?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_amenity_settings_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_amenity_settings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: true
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
      venue_memberships: {
        Row: {
          end_kind: string | null
          end_reason: string | null
          ended_at: string | null
          ended_by: string | null
          grant_reason: string | null
          granted_at: string
          granted_by: string | null
          id: string
          profile_id: string
          role: string
          source: string
          venue_id: string
        }
        Insert: {
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
          role: string
          source: string
          venue_id: string
        }
        Update: {
          end_kind?: string | null
          end_reason?: string | null
          ended_at?: string | null
          ended_by?: string | null
          grant_reason?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
          role?: string
          source?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_memberships_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_memberships_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_memberships_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_scope: {
        Row: {
          applicable: boolean
          reason: string
          revision: number
          scope_key: string
          set_at: string
          set_by: string
          venue_id: string
        }
        Insert: {
          applicable: boolean
          reason: string
          revision?: number
          scope_key: string
          set_at?: string
          set_by: string
          venue_id: string
        }
        Update: {
          applicable?: boolean
          reason?: string
          revision?: number
          scope_key?: string
          set_at?: string
          set_by?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_scope_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_scope_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_scope_events: {
        Row: {
          actor_id: string
          applicable_after: boolean
          applicable_before: boolean | null
          created_at: string
          id: number
          reason: string
          scope_key: string
          venue_id: string
        }
        Insert: {
          actor_id: string
          applicable_after: boolean
          applicable_before?: boolean | null
          created_at?: string
          id?: never
          reason: string
          scope_key: string
          venue_id: string
        }
        Update: {
          actor_id?: string
          applicable_after?: boolean
          applicable_before?: boolean | null
          created_at?: string
          id?: never
          reason?: string
          scope_key?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_scope_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_scope_events_venue_id_fkey"
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
          locality: string | null
          name: string
          operating_status: string
          slug: string
          timezone: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          locality?: string | null
          name: string
          operating_status?: string
          slug: string
          timezone?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          locality?: string | null
          name?: string
          operating_status?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
    }
    Views: {
      upload_label_metrics: {
        Row: {
          day: string | null
          median_seconds_to_label: number | null
          needs_attention: number | null
          p90_seconds_to_label: number | null
          share_labelled: number | null
          uploads: number | null
          uploads_labelled: number | null
          venue_id: string | null
          venue_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_contribution_notice: {
        Args: { p_version: string }
        Returns: string
      }
      acquire_maintenance_lease: {
        Args: { p_holder: string; p_name: string; p_ttl: string }
        Returns: boolean
      }
      activate_menu_version: {
        Args: { p_expected_revision: number; p_version_id: string }
        Returns: undefined
      }
      activate_menu_version_confirmed: {
        Args: {
          p_expected_revision: number
          p_retirements: number
          p_version_id: string
        }
        Returns: undefined
      }
      admin_activity: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_before?: Json
          p_limit?: number
          p_source?: string
          p_venue_id?: string
        }
        Returns: Json
      }
      admin_delete_media_asset: {
        Args: { p_asset_id: string; p_impact_token: string; p_reason: string }
        Returns: Json
      }
      admin_grant_admin: {
        Args: { p_profile_id: string; p_reason: string }
        Returns: undefined
      }
      admin_revoke_admin: {
        Args: { p_profile_id: string; p_reason: string; p_venue_id: string }
        Returns: undefined
      }
      admin_set_venue_membership: {
        Args: {
          p_profile_id: string
          p_reason?: string
          p_role: string
          p_venue_id: string
        }
        Returns: string
      }
      album_admin_counts: { Args: { p_venue_id: string }; Returns: Json }
      album_area_states: { Args: { p_venue_id?: string }; Returns: Json }
      album_brief_set: {
        Args: {
          p_brief: string
          p_key: string
          p_source: string
          p_venue_id: string
        }
        Returns: Json
      }
      album_briefs: { Args: { p_venue_id?: string }; Returns: Json }
      album_place_set: {
        Args: {
          p_key: string
          p_source: string
          p_subject_id: string
          p_venue_id: string
        }
        Returns: Json
      }
      album_places: { Args: { p_venue_id?: string }; Returns: Json }
      album_slot_asset: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          media_type: Database["public"]["Enums"]["media_type"]
          venue_id: string
          width: number
        }[]
      }
      album_slot_photos: { Args: { p_venue_id?: string }; Returns: Json }
      amenity_add_checks:
        | { Args: { p_keys: string[]; p_venue_id: string }; Returns: string[] }
        | {
            Args: {
              p_idempotency_key: string
              p_keys: string[]
              p_venue_id: string
            }
            Returns: Json
          }
      amenity_archive_check:
        | { Args: { p_check_id: string; p_revision: number }; Returns: number }
        | {
            Args: {
              p_check_id: string
              p_idempotency_key: string
              p_revision: number
            }
            Returns: Json
          }
      amenity_assign_check:
        | {
            Args: {
              p_assignee_id: string
              p_check_id: string
              p_revision: number
            }
            Returns: number
          }
        | {
            Args: {
              p_assignee_id: string
              p_check_id: string
              p_idempotency_key: string
              p_revision: number
            }
            Returns: Json
          }
      amenity_assignee_options: {
        Args: { p_check_id: string }
        Returns: {
          display_name: string
          id: string
          job_title: string
        }[]
      }
      amenity_catalogue_for_venue: {
        Args: { p_venue_id: string }
        Returns: {
          capture_brief: string
          catalogue_version: number
          category: string
          check_id: string
          check_status: string
          evidence_rule: string
          is_core: boolean
          key: string
          position: number
          question: string
        }[]
      }
      amenity_check: {
        Args: { p_check_id: string }
        Returns: {
          answer: string
          answered_at: string
          answered_by: string
          answered_by_name: string
          assignee_name: string
          assignee_user_id: string
          capture_brief: string
          catalogue_version: number
          category: string
          current_submission_id: string
          evidence_rule: string
          id: string
          is_core: boolean
          notes: string
          position: number
          progress: string
          qualification: string
          question: string
          recheck_reason: string
          revision: number
          status: string
          template_key: string
          updated_at: string
          venue_id: string
        }[]
      }
      amenity_check_events: {
        Args: { p_check_id: string }
        Returns: {
          actor_id: string
          actor_name: string
          check_id: string
          created_at: string
          detail: Json
          id: string
          kind: string
          reason: string
        }[]
      }
      amenity_check_set_applicability: {
        Args: {
          p_applicable: boolean
          p_check_id: string
          p_idempotency_key: string
          p_reason: string
          p_revision: number
        }
        Returns: Json
      }
      amenity_check_submission_assets: {
        Args: { p_check_id: string }
        Returns: {
          asset_id: string
          available: boolean
          evidence_kind: string
          has_preview: boolean
          has_thumbnail: boolean
          submission_id: string
        }[]
      }
      amenity_check_submissions: {
        Args: { p_check_id: string }
        Returns: {
          answer: string
          check_id: string
          created_at: string
          evidence_rule: string
          finding: string
          id: string
          internal_metadata: Json
          limitations: string
          qualification: string
          reason: string
          submitted_by: string
          submitted_by_name: string
          template_version: number
        }[]
      }
      amenity_checks_for_venue: {
        Args: { p_include_archived: boolean; p_venue_id: string }
        Returns: {
          answer: string
          answered_at: string
          answered_by: string
          answered_by_name: string
          assignee_name: string
          assignee_user_id: string
          capture_brief: string
          catalogue_version: number
          category: string
          current_submission_id: string
          evidence_rule: string
          id: string
          is_core: boolean
          notes: string
          position: number
          progress: string
          qualification: string
          question: string
          recheck_reason: string
          revision: number
          status: string
          template_key: string
          updated_at: string
          venue_id: string
        }[]
      }
      amenity_enable_venue: { Args: { p_venue_id: string }; Returns: number }
      amenity_evidence_asset: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          media_type: Database["public"]["Enums"]["media_type"]
        }[]
      }
      amenity_my_checks: {
        Args: never
        Returns: {
          answer: string
          answered_at: string
          answered_by: string
          answered_by_name: string
          assignee_name: string
          assignee_user_id: string
          capture_brief: string
          catalogue_version: number
          category: string
          current_submission_id: string
          evidence_rule: string
          id: string
          is_core: boolean
          notes: string
          position: number
          progress: string
          question: string
          recheck_reason: string
          revision: number
          status: string
          template_key: string
          updated_at: string
          venue_id: string
        }[]
      }
      amenity_photo_queue: {
        Args: { p_limit?: number; p_status?: string; p_venue_id?: string }
        Returns: {
          asset_id: string
          can_decide: boolean
          category: string
          check_id: string
          decided_at: string
          has_preview: boolean
          has_thumbnail: boolean
          photo_required: boolean
          question: string
          question_key: string
          reason: string
          review_level: string
          state: string
          uploaded_at: string
          uploader_id: string
          uploader_name: string
        }[]
      }
      amenity_reopen_check:
        | {
            Args: {
              p_check_id: string
              p_preset: string
              p_reason: string
              p_revision: number
            }
            Returns: number
          }
        | {
            Args: {
              p_check_id: string
              p_idempotency_key: string
              p_preset: string
              p_reason: string
              p_revision: number
            }
            Returns: Json
          }
      amenity_restore_check:
        | { Args: { p_check_id: string; p_revision: number }; Returns: number }
        | {
            Args: {
              p_check_id: string
              p_idempotency_key: string
              p_revision: number
            }
            Returns: Json
          }
      amenity_set_check_notes:
        | {
            Args: { p_check_id: string; p_notes: string; p_revision: number }
            Returns: number
          }
        | {
            Args: {
              p_check_id: string
              p_idempotency_key: string
              p_notes: string
              p_revision: number
            }
            Returns: Json
          }
      amenity_submit_finding: {
        Args: {
          p_answer: string
          p_asset_ids: string[]
          p_check_id: string
          p_finding: string
          p_idempotency_key: string
          p_internal_metadata: Json
          p_limitations: string
          p_reason: string
          p_redaction_confirmed: boolean
          p_revision: number
        }
        Returns: {
          replayed: boolean
          revision: number
          submission_id: string
        }[]
      }
      amenity_submittable_assets: {
        Args: { p_check_id: string }
        Returns: {
          asset_id: string
          created_at: string
          has_thumbnail: boolean
          media_type: Database["public"]["Enums"]["media_type"]
          source: string
        }[]
      }
      amenity_venue_state: {
        Args: { p_venue_id: string }
        Returns: {
          can_enable: boolean
          enabled: boolean
          venue_id: string
          venue_name: string
        }[]
      }
      area_photo_asset: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          media_type: Database["public"]["Enums"]["media_type"]
          uploader_id: string
          validated_mime_type: string
          venue_id: string
          width: number
        }[]
      }
      area_photo_freshness_list: {
        Args: { p_venue_id?: string }
        Returns: {
          asset_id: string
          cause: string
          due_soon: boolean
          label_id: string
          next_check_due: string
          reason: string
          state: string
          subject_id: string
          subject_kind: string
          subject_label: string
          valid_until: string
          verified_on: string
        }[]
      }
      area_photo_queue: {
        Args: { p_limit?: number; p_status?: string; p_venue_id?: string }
        Returns: {
          asset_id: string
          author_id: string
          author_name: string
          can_decide: boolean
          credit_month: string
          decided_at: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          label_id: string
          labelled_at: string
          reason: string
          state: string
          subject_id: string
          subject_kind: string
          subject_label: string
          uploaded_at: string
          venue_id: string
          width: number
        }[]
      }
      area_photo_reconfirm: {
        Args: { p_checked_on?: string; p_note?: string; p_subject_id: string }
        Returns: Json
      }
      area_photo_report_change: {
        Args: {
          p_reason: string
          p_replacement?: boolean
          p_subject_id: string
        }
        Returns: Json
      }
      area_photo_set_end_date: {
        Args: { p_label_id: string; p_reason?: string; p_valid_until: string }
        Returns: Json
      }
      asset_search: {
        Args: {
          p_after_created_at?: string
          p_after_id?: string
          p_filters?: Json
          p_limit?: number
        }
        Returns: Json
      }
      asset_search_answers: { Args: { p_asset_ids: string[] }; Returns: Json }
      asset_search_can_open: { Args: { p_asset_id: string }; Returns: boolean }
      asset_usages: {
        Args: { p_asset_id?: string; p_venue_id?: string }
        Returns: Json
      }
      asset_use_status: { Args: { p_asset_id: string }; Returns: Json }
      assign_menu_item_photo: {
        Args: {
          p_asset_id: string
          p_client_request_key?: string
          p_corrects_item_id: string
          p_corrects_variant_id: string
          p_expected_revision: number
          p_item_id: string
          p_make_primary?: boolean
          p_reason: string
          p_variant_id: string
        }
        Returns: {
          corrects_item_revision: number
          is_primary: boolean
          item_id: string
          item_revision: number
          photo_id: string
          replayed: boolean
          state: string
        }[]
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
      cancel_media_removal_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      claim_archive_monitor_alert: { Args: never; Returns: Json }
      clear_menu_item_needed_by: {
        Args: { p_item_id: string; p_venue_id?: string }
        Returns: {
          cleared: boolean
          item_id: string
          venue_id: string
        }[]
      }
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
          duration_seconds: number
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          size_bytes: number
          uploader_id: string
          validated_mime_type: string
          venue_name: string
          width: number
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
          avatar_path: string
          department: string
          display_name: string
          id: string
          job_title: string
          media_count: number
          venue_id: string
          venue_name: string
        }[]
      }
      community_readable_assets: {
        Args: { p_asset_ids: string[] }
        Returns: {
          created_at: string
          duration_seconds: number
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          size_bytes: number
          uploader_id: string
          validated_mime_type: string
          venue_id: string
          width: number
        }[]
      }
      complete_archive_monitor_alert: {
        Args: { p_claim_id: string; p_event_id: string }
        Returns: boolean
      }
      complete_media_finalise: {
        Args: {
          p_asset_id: string
          p_captured_at?: string
          p_content_sha256?: string
          p_duration_seconds?: number
          p_height?: number
          p_preview_path?: string
          p_size_bytes: number
          p_thumbnail_path?: string
          p_validated_mime_type: string
          p_width?: number
        }
        Returns: {
          became_ready: boolean
          duplicate_of_asset_id: string
          labels_code: string
          labels_has_labels: boolean
          labels_revision: number
          labels_state: string
        }[]
      }
      confirm_menu_coverage_plan: {
        Args: { p_expected_revision: number; p_plan_id: string }
        Returns: {
          auto_retired: number
          plan_id: string
          reconciliation_required: boolean
        }[]
      }
      contribution_group: { Args: { p_group_id: string }; Returns: Json }
      contribution_group_add: {
        Args: { p_asset_ids: string[]; p_group_id: string }
        Returns: number
      }
      contribution_group_replace: {
        Args: {
          p_failed_asset_id: string
          p_group_id: string
          p_new_asset_id: string
        }
        Returns: Json
      }
      contribution_group_start: {
        Args: { p_key: string; p_subject_id: string; p_subject_kind: string }
        Returns: string
      }
      contribution_groups_for_assets: {
        Args: { p_asset_ids: string[] }
        Returns: {
          asset_id: string
          group_id: string
        }[]
      }
      convert_account_to_manager: {
        Args: {
          p_client_request_key: string
          p_profile_id: string
          p_reason: string
          p_venue_id: string
        }
        Returns: {
          grant_id: string
          profile_id: string
          replayed: boolean
          role: Database["public"]["Enums"]["app_role"]
          venue_id: string
        }[]
      }
      convert_manager_to_staff: {
        Args: {
          p_client_request_key: string
          p_profile_id: string
          p_reason: string
          p_venue_id: string
        }
        Returns: {
          profile_id: string
          replayed: boolean
          role: Database["public"]["Enums"]["app_role"]
          venue_id: string
        }[]
      }
      coverage_access_scope: {
        Args: never
        Returns: {
          active: boolean
          department: string
          is_admin: boolean
          manager_grant_id: string
          manager_venue_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          venue_active: boolean
          venue_id: string
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
          height: number
          live_item_id: string
          live_item_state: string
          live_requirement_id: string
          monthly_eligible_now: boolean
          uploaded_month: string
          uploader_active: boolean
          uploader_id: string
          uploader_name: string
          venue_id: string
          width: number
        }[]
      }
      coverage_completion_target_periods: {
        Args: { p_period_months: string[]; p_venue_id: string }
        Returns: string[]
      }
      coverage_group_overview: {
        Args: { p_period_month?: string }
        Returns: {
          accepted_photos: number
          amenity_unknown_count: number
          applicable_count: number
          coverage_complete: boolean
          last_preparation_at: string
          last_preparation_status: string
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
          decided_at: string
          decided_by: string
          decision_reason: string
          evidence_available: boolean
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          item_id: string
          media_type: Database["public"]["Enums"]["media_type"]
          monthly_eligible: boolean
          origin: string
          replaces_item_id: string
          requirement_id: string
          requirement_title: string
          revision: number
          self_review: boolean
          state: string
          submitted_at: string
          submitted_by: string
          submitted_month: string
          uploaded_month: string
          venue_id: string
          width: number
        }[]
      }
      coverage_preparation_status: {
        Args: { p_venue_id?: string }
        Returns: {
          last_error_code: string
          last_failure_at: string
          last_run_at: string
          last_status: string
          last_success_at: string
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
          amenity_key: string
          amenity_presence: string
          assignee_ids: string[]
          due_on: string
          evidence_removed_count: number
          guidance: string
          is_current: boolean
          kind: string
          menu_plan_id: string
          menu_plan_status: string
          menu_version_id: string
          needs_another_photo_count: number
          needs_reassignment: boolean
          overdue: boolean
          pending_count: number
          photo_target: number
          requirement_id: string
          revision: number
          satisfied: boolean
          section_snapshot: Json
          status: string
          status_reason: string
          title: string
          venue_id: string
        }[]
      }
      coverage_slots: { Args: { p_venue_id?: string }; Returns: Json }
      coverage_staff_progress: {
        Args: {
          p_period_month?: string
          p_staff_id?: string
          p_venue_id?: string
        }
        Returns: {
          accepted_count: number
          avatar_path: string
          complete: boolean
          department: string
          display_name: string
          due_on: string
          evidence_removed_count: number
          is_current_member: boolean
          is_manager: boolean
          job_title: string
          late_accepted_count: number
          needs_another_photo_count: number
          needs_setup: boolean
          overdue: boolean
          pending_count: number
          period_month: string
          setup_missing: string[]
          staff_id: string
          target_count: number
          target_id: string
          target_revision: number
          target_source: string
          venue_id: string
          venue_name: string
        }[]
      }
      coverage_staff_progress_v2: {
        Args: {
          p_period_month?: string
          p_staff_id?: string
          p_venue_id?: string
        }
        Returns: {
          accepted_count: number
          amenity_checks_completed: number
          avatar_path: string
          complete: boolean
          completion_count: number
          department: string
          display_name: string
          due_on: string
          evidence_removed_count: number
          is_current_member: boolean
          is_manager: boolean
          job_title: string
          late_accepted_count: number
          menu_items_completed: number
          needs_another_photo_count: number
          needs_setup: boolean
          overdue: boolean
          pending_count: number
          period_month: string
          setup_missing: string[]
          staff_id: string
          target_basis: string
          target_count: number
          target_id: string
          target_revision: number
          target_source: string
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
      decide_amenity_photo: {
        Args: {
          p_action: string
          p_asset_id: string
          p_check_id: string
          p_level?: string
          p_reason?: string
        }
        Returns: {
          asset_id: string
          changed: boolean
          check_id: string
          review_level: string
          state: string
        }[]
      }
      decide_area_photo: {
        Args: { p_action: string; p_label_id: string; p_reason?: string }
        Returns: {
          changed: boolean
          label_id: string
          state: string
        }[]
      }
      decide_area_photo_level: {
        Args: {
          p_action: string
          p_label_id: string
          p_level?: string
          p_reason?: string
        }
        Returns: {
          changed: boolean
          label_id: string
          review_level: string
          state: string
        }[]
      }
      decline_media_removal_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      delete_media_asset: { Args: { p_asset_id: string }; Returns: undefined }
      discard_menu_coverage_plan: {
        Args: { p_expected_revision: number; p_plan_id: string }
        Returns: undefined
      }
      discard_menu_draft: { Args: { p_version_id: string }; Returns: undefined }
      discard_unusable_media_labels: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      evidence_document_complete: {
        Args: { p_id: string; p_sha256: string; p_size: number }
        Returns: Json
      }
      evidence_document_delete: { Args: { p_id: string }; Returns: Json }
      evidence_document_download_target: {
        Args: { p_id: string }
        Returns: Json
      }
      evidence_document_fail: { Args: { p_id: string }; Returns: Json }
      evidence_document_finalise_target: {
        Args: { p_id: string }
        Returns: Json
      }
      evidence_document_meta: { Args: { p_ids: string[] }; Returns: Json }
      evidence_document_reserve: {
        Args: {
          p_filename: string
          p_key: string
          p_purpose: string
          p_size: number
          p_venue_id: string
        }
        Returns: Json
      }
      export_asset_status: { Args: { p_asset_id: string }; Returns: Json }
      export_asset_thumb: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          media_type: Database["public"]["Enums"]["media_type"]
          venue_id: string
          width: number
        }[]
      }
      export_candidates: {
        Args: { p_mode?: string; p_venue_id: string }
        Returns: Json
      }
      export_package_create: {
        Args: {
          p_custom_height?: number
          p_custom_width?: number
          p_items: Json
          p_mode: string
          p_note?: string
          p_profile_key: string
          p_request_key: string
        }
        Returns: Json
      }
      export_package_detail: { Args: { p_package_id: string }; Returns: Json }
      export_package_download_finish: {
        Args: { p_completed: boolean; p_download_id: string; p_files?: Json }
        Returns: Json
      }
      export_package_download_start: {
        Args: { p_package_id: string }
        Returns: Json
      }
      export_package_rebuild: {
        Args: { p_package_id: string; p_request_key: string }
        Returns: Json
      }
      export_packages_list: {
        Args: { p_limit?: number; p_venue_id?: string }
        Returns: Json
      }
      export_profile_set: {
        Args: {
          p_expected_revision: number
          p_format: string
          p_key: string
          p_label: string
          p_max_height: number
          p_max_width: number
          p_quality: number
        }
        Returns: Json
      }
      export_profiles: { Args: never; Returns: Json }
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
      knowledge_check: { Args: { p_check_id: string }; Returns: Json }
      knowledge_check_rechecks: { Args: { p_check_id: string }; Returns: Json }
      knowledge_correct: {
        Args: {
          p_check_id: string
          p_detail: Json
          p_headline: string
          p_idempotency_key: string
          p_reason: string
          p_slot_revision: number
        }
        Returns: Json
      }
      knowledge_decide: {
        Args: {
          p_decision: string
          p_idempotency_key: string
          p_note: string
          p_slot_revision: number
          p_target_id: string
          p_target_type: string
        }
        Returns: Json
      }
      knowledge_discard_draft: {
        Args: { p_check_id: string }
        Returns: boolean
      }
      knowledge_dismiss_outcome: {
        Args: { p_event_id: number }
        Returns: boolean
      }
      knowledge_fact_coverage: { Args: { p_venue_id: string }; Returns: Json }
      knowledge_fact_states: { Args: { p_venue_id: string }; Returns: Json }
      knowledge_freshness_policies: { Args: never; Returns: Json }
      knowledge_freshness_preview: {
        Args: { p_key: string; p_policy: Json }
        Returns: Json
      }
      knowledge_get_draft: { Args: { p_check_id: string }; Returns: Json }
      knowledge_guest_answers: {
        Args: { p_keys: string[]; p_use?: string; p_venue_id: string }
        Returns: Json
      }
      knowledge_legacy_mappings: {
        Args: { p_cursor?: string; p_venue_id?: string }
        Returns: Json
      }
      knowledge_legacy_narrative: {
        Args: { p_venue_id?: string }
        Returns: Json
      }
      knowledge_legacy_narrative_for_question: {
        Args: { p_question_key: string; p_venue_id?: string }
        Returns: Json
      }
      knowledge_mapping_review: {
        Args: {
          p_idempotency_key: string
          p_kind: string
          p_legacy_fact_id: string
          p_legacy_revision: number
          p_question_key: string
          p_reason: string
        }
        Returns: Json
      }
      knowledge_my_contributions: {
        Args: { p_cursor: string; p_limit: number }
        Returns: Json
      }
      knowledge_my_pending: { Args: { p_period: string }; Returns: Json }
      knowledge_occurrences: {
        Args: { p_check_id: string; p_from: string; p_to: string }
        Returns: {
          ends_at: string
          local_date: string
          starts_at: string
          state: string
        }[]
      }
      knowledge_pilot_preview: { Args: { p_venue_id: string }; Returns: Json }
      knowledge_question: {
        Args: { p_key: string; p_version?: number }
        Returns: Json
      }
      knowledge_reader_answers_v1: {
        Args: { p_keys: string[]; p_venue_id: string }
        Returns: {
          confirmation_basis: string
          confirmation_required: boolean
          confirmation_saved_at: string
          confirmation_self: boolean
          confirmation_state: string
          contribution_kind: string
          current_contribution_id: string
          current_submission_id: string
          detail: string
          evidence_photos: number
          evidence_videos: number
          finding: string
          freshness_state: string
          limitations: string
          next_check_due: string
          observed_at: string
          question_key: string
          question_version: number
          reason: string
          reason_text: string
          redaction_proof: string
          revision: number
          saved_at: string
          source_basis: string
          source_origin: string
          status: string
          value: string
        }[]
      }
      knowledge_reconcile: {
        Args: { p_kind: string; p_mode: string; p_venue_id?: string }
        Returns: Json
      }
      knowledge_reconciliation_run: {
        Args: { p_run_id: string }
        Returns: Json
      }
      knowledge_reconciliation_runs: {
        Args: { p_cursor?: string }
        Returns: Json
      }
      knowledge_reconfirm: {
        Args: {
          p_check_id: string
          p_checked_on?: string
          p_next_check_on?: string
          p_note?: string
          p_reconfirm?: boolean
          p_slot_revision: number
        }
        Returns: Json
      }
      knowledge_registry: { Args: { p_lifecycle?: string[] }; Returns: Json }
      knowledge_resolve_conflict: {
        Args: {
          p_check_id: string
          p_choose: string
          p_idempotency_key: string
          p_reason: string
          p_slot_revision: number
        }
        Returns: Json
      }
      knowledge_run_rechecks: { Args: never; Returns: Json }
      knowledge_save_draft:
        | {
            Args: {
              p_asset_ids: string[]
              p_check_id: string
              p_draft_revision: number
              p_idempotency_key: string
              p_payload: Json
            }
            Returns: Json
          }
        | {
            Args: {
              p_asset_ids: string[]
              p_base_sent_at: string
              p_check_id: string
              p_draft_revision: number
              p_idempotency_key: string
              p_payload: Json
            }
            Returns: Json
          }
      knowledge_schedule_exception: {
        Args: {
          p_check_id: string
          p_idempotency_key: string
          p_kind: string
          p_local_date: string
          p_note: string
          p_schedule_id: string
          p_slot_revision: number
          p_windows: Json
        }
        Returns: Json
      }
      knowledge_schedule_preview: {
        Args: {
          p_from: string
          p_schedule: Json
          p_timezone: string
          p_to: string
        }
        Returns: {
          ends_at: string
          local_date: string
          starts_at: string
          state: string
        }[]
      }
      knowledge_set_working_list: {
        Args: {
          p_enabled: boolean
          p_keys: string[]
          p_reason: string
          p_venue_id: string
        }
        Returns: number
      }
      knowledge_slot_events: {
        Args: { p_check_id: string; p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      knowledge_slot_history: {
        Args: { p_at?: string; p_check_id: string }
        Returns: Json
      }
      knowledge_source_declare: {
        Args: {
          p_idempotency_key: string
          p_kind: string
          p_label: string
          p_venue_id: string
        }
        Returns: Json
      }
      knowledge_source_import: {
        Args: {
          p_assertions: Json
          p_idempotency_key: string
          p_retrieved_at: string
          p_source_id: string
          p_source_revision: string
        }
        Returns: Json
      }
      knowledge_source_retire: {
        Args: {
          p_idempotency_key: string
          p_reason: string
          p_source_id: string
        }
        Returns: Json
      }
      knowledge_sources: {
        Args: { p_include_retired?: boolean }
        Returns: Json
      }
      knowledge_subject_add: {
        Args: {
          p_idempotency_key: string
          p_kind: string
          p_label: string
          p_venue_id: string
        }
        Returns: Json
      }
      knowledge_subject_retire: {
        Args: {
          p_idempotency_key: string
          p_reason: string
          p_subject_id: string
        }
        Returns: Json
      }
      knowledge_subjects: { Args: { p_venue_id?: string }; Returns: Json }
      knowledge_submit:
        | {
            Args: {
              p_answer: string
              p_asset_ids: string[]
              p_change_reason: string
              p_check_id: string
              p_confirm_own: boolean
              p_finding: string
              p_idempotency_key: string
              p_internal_metadata: Json
              p_kind: string
              p_limitations: string
              p_reason: string
              p_redaction_confirmed: boolean
              p_responds_to: string
              p_slot_revision: number
              p_tried_text: string
              p_unknown_preset: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_answer: string
              p_asset_ids: string[]
              p_change_reason: string
              p_check_id: string
              p_confirm_own: boolean
              p_detail: Json
              p_finding: string
              p_idempotency_key: string
              p_internal_metadata: Json
              p_kind: string
              p_limitations: string
              p_observed_on: string
              p_observed_on_source: string
              p_reason: string
              p_redaction_confirmed: boolean
              p_responds_to: string
              p_slot_revision: number
              p_tried_text: string
              p_unknown_preset: string
            }
            Returns: Json
          }
      knowledge_to_confirm: { Args: { p_venue_id: string }; Returns: Json }
      knowledge_upgrade_run: {
        Args: { p_key: string; p_mode: string }
        Returns: Json
      }
      knowledge_value_list: { Args: { p_list: string }; Returns: Json }
      knowledge_venue_rechecks: { Args: { p_venue_id?: string }; Returns: Json }
      knowledge_withdraw: {
        Args: {
          p_check_id: string
          p_idempotency_key: string
          p_reason: string
          p_slot_revision: number
        }
        Returns: Json
      }
      knowledge_working_list: { Args: never; Returns: Json }
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
          captured_at: string | null
          captured_at_set_by: string | null
          captured_at_source: string
          client_batch_id: string | null
          client_upload_key: string | null
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          duplicate_of_asset_id: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path: string | null
          purpose: string
          size_bytes: number | null
          thumbnail_path: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          uploader_role: Database["public"]["Enums"]["app_role"] | null
          use_baseline: string
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
          captured_at: string | null
          captured_at_set_by: string | null
          captured_at_source: string
          client_batch_id: string | null
          client_upload_key: string | null
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          duplicate_of_asset_id: string | null
          duration_seconds: number | null
          height: number | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_filename: string
          original_path: string
          preview_path: string | null
          purpose: string
          size_bytes: number | null
          thumbnail_path: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["upload_state"]
          uploader_id: string
          uploader_role: Database["public"]["Enums"]["app_role"] | null
          use_baseline: string
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
      manager_grant_candidates: {
        Args: { p_venue_id: string }
        Returns: {
          display_name: string
          id: string
          venue_id: string
        }[]
      }
      manager_invite_staff: {
        Args: {
          p_display_name: string
          p_job_title?: string
          p_user_id: string
          p_venue_id: string
        }
        Returns: {
          membership_id: string
          outcome: string
          profile_id: string
        }[]
      }
      manager_menu_photo_contributor: {
        Args: { p_contributor_id: string; p_venue_id: string }
        Returns: {
          accepted_items: number
          contributor_id: string
          display_name: string
          labelled_photos: number
          last_upload_at: string
          open_follow_ups: number
          status: string
        }[]
      }
      manager_menu_photo_contributors: {
        Args: { p_venue_id?: string }
        Returns: {
          accepted_items: number
          contributor_id: string
          display_name: string
          labelled_photos: number
          last_upload_at: string
          open_follow_ups: number
          status: string
        }[]
      }
      manager_menu_photo_item: {
        Args: { p_item_id: string; p_venue_id: string }
        Returns: {
          covered: boolean
          description: string
          item_id: string
          item_revision: number
          name: string
          photos: Json
          preferred_asset_id: string
          preferred_is_fallback: boolean
          preferred_photo_id: string
          section_id: string
          section_kind: string
          section_name: string
          status: string
          variants: Json
        }[]
      }
      manager_menu_photo_item_events: {
        Args: {
          p_before_id?: number
          p_item_id: string
          p_limit?: number
          p_venue_id: string
        }
        Returns: {
          action: string
          actor_name: string
          actor_role: string
          asset_id: string
          created_at: string
          detail: Json
          from_state: string
          id: number
          photo_id: string
          reason: string
          to_state: string
        }[]
      }
      manager_menu_photo_items: {
        Args: {
          p_after_entry_position?: number
          p_after_item_id?: string
          p_after_needed_by?: string
          p_after_section_position?: number
          p_limit?: number
          p_query?: string
          p_section_id?: string
          p_status?: string
          p_venue_id?: string
        }
        Returns: {
          accepted_count: number
          candidate_count: number
          covered: boolean
          description: string
          entry_position: number
          has_pending_replacement: boolean
          item_id: string
          item_revision: number
          menu_version_id: string
          name: string
          needed_by: string
          needed_by_passed: boolean
          needs_recheck: boolean
          needs_recheck_count: number
          oldest_candidate_at: string
          others_waiting: number
          own_waiting: number
          primary_asset_id: string
          primary_has_preview: boolean
          primary_has_thumbnail: boolean
          primary_height: number
          primary_photo_id: string
          primary_width: number
          section_id: string
          section_kind: string
          section_name: string
          section_position: number
          status: string
          variants: Json
          venue_id: string
        }[]
      }
      manager_menu_photo_overview: {
        Args: { p_venue_id?: string }
        Returns: {
          activated_at: string
          awaiting_review_items: number
          carried_items: number
          covered_items: number
          eligible_items: number
          menu_state: string
          menu_title: string
          menu_version_id: string
          needs_photo_items: number
          needs_recheck_items: number
          new_items: number
          oldest_pending_at: string
          own_waiting_photos: number
          pending_photos: number
          replacement_pending_items: number
          sections: Json
          venue_id: string
          venue_name: string
        }[]
      }
      manager_menu_photo_queue: {
        Args: {
          p_after_created_at?: string
          p_after_key?: string
          p_contributor_id?: string
          p_item_id?: string
          p_limit?: number
          p_section_id?: string
          p_status?: string
          p_venue_id?: string
        }
        Returns: {
          asset_id: string
          basis: string
          can_follow_up: boolean
          contributor_status: string
          corrects_item_id: string
          corrects_item_name: string
          corrects_variant_id: string
          created_at: string
          group_count: number
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          is_effective_primary: boolean
          is_primary: boolean
          is_self: boolean
          item_covered: boolean
          item_id: string
          item_name: string
          item_revision: number
          kind: string
          label_id: string
          labelled_at: string
          photo_id: string
          photo_state: string
          reason: string
          recheck_kind: string
          section_id: string
          section_name: string
          sort_key: string
          staff_label: Json
          uploader_id: string
          uploader_name: string
          variant_id: string
          variant_name: string
          width: number
        }[]
      }
      manager_triage_summary: {
        Args: { p_venue_id?: string }
        Returns: {
          available: boolean
          oldest_waiting_at: string
          own_waiting: number
          queue: string
          waiting: number
        }[]
      }
      manager_workspace_scope: {
        Args: never
        Returns: {
          active: boolean
          display_name: string
          effective: boolean
          grant_id: string
          grant_venue_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          venue_active: boolean
          venue_id: string
          venue_name: string
        }[]
      }
      mark_notifications_read: { Args: { p_ids?: number[] }; Returns: number }
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
      media_removal_impact: { Args: { p_asset_id: string }; Returns: Json }
      media_removal_requests: {
        Args: { p_state?: string; p_venue_id?: string }
        Returns: Json
      }
      media_use_grant_create: {
        Args: {
          p_asset_id: string
          p_clearance: Json
          p_clearance_version: string
          p_destination_key: string
          p_effective_from: string
          p_effective_until: string
          p_note: string
          p_profile_key: string
          p_purpose: string
          p_request_key: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: Json
      }
      media_use_grant_withdraw: {
        Args: {
          p_grant_id: string
          p_note: string
          p_reason_code: string
          p_request_key: string
        }
        Returns: Json
      }
      media_use_withdraw_asset: {
        Args: {
          p_asset_id: string
          p_note: string
          p_reason_code: string
          p_request_key: string
        }
        Returns: Json
      }
      menu_activate_due: { Args: { p_venue_id: string }; Returns: number }
      menu_activate_due_all: { Args: never; Returns: number }
      menu_change_request_create: {
        Args: {
          p_detail: string
          p_item_id: string
          p_kind: string
          p_venue_id: string
        }
        Returns: Json
      }
      menu_change_request_decide: {
        Args: {
          p_decision: string
          p_reason: string
          p_request_id: string
          p_revision: number
        }
        Returns: Json
      }
      menu_change_request_withdraw: {
        Args: { p_request_id: string; p_revision: number }
        Returns: Json
      }
      menu_change_requests_list: {
        Args: { p_status?: string; p_venue_id?: string }
        Returns: Json
      }
      menu_item_availability_set: {
        Args: {
          p_available: boolean
          p_item_id: string
          p_reason?: string
          p_until?: string
        }
        Returns: Json
      }
      menu_item_display_name_set: {
        Args: { p_item_id: string; p_name: string; p_reason?: string }
        Returns: Json
      }
      menu_item_photo_asset: {
        Args: { p_asset_id: string }
        Returns: {
          asset_id: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          media_type: Database["public"]["Enums"]["media_type"]
          uploader_id: string
          validated_mime_type: string
          venue_id: string
          width: number
        }[]
      }
      menu_item_photo_candidates: {
        Args: {
          p_after_created_at?: string
          p_after_label_id?: string
          p_include_reviewed?: boolean
          p_item_id?: string
          p_limit?: number
          p_venue_id?: string
        }
        Returns: {
          asset_id: string
          created_at: string
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          is_primary: boolean
          is_self: boolean
          item_id: string
          item_name: string
          item_revision: number
          label_id: string
          labelled_at: string
          photo_id: string
          photo_state: string
          section_name: string
          uploader_active: boolean
          uploader_id: string
          uploader_name: string
          variant_id: string
          variant_name: string
          venue_id: string
          width: number
        }[]
      }
      menu_item_photo_items: {
        Args: {
          p_after_entry_position?: number
          p_after_item_id?: string
          p_after_needed_by?: string
          p_after_section_position?: number
          p_gaps_only?: boolean
          p_limit?: number
          p_query?: string
          p_section_id?: string
          p_venue_id?: string
        }
        Returns: {
          accepted_count: number
          candidate_count: number
          covered: boolean
          description: string
          entry_position: number
          item_id: string
          item_revision: number
          menu_version_id: string
          name: string
          needed_by: string
          needed_by_passed: boolean
          needs_recheck_count: number
          oldest_candidate_at: string
          primary_asset_id: string
          primary_has_preview: boolean
          primary_has_thumbnail: boolean
          primary_height: number
          primary_photo_id: string
          primary_width: number
          section_id: string
          section_kind: string
          section_name: string
          section_position: number
          variants: Json
          venue_id: string
        }[]
      }
      menu_item_photo_summary: {
        Args: { p_venue_id?: string }
        Returns: {
          covered_items: number
          eligible_items: number
          menu_state: string
          menu_version_id: string
          needs_recheck_items: number
          oldest_candidate_at: string
          pending_candidates: number
          section_id: string
          section_kind: string
          section_name: string
          section_position: number
          venue_id: string
          venue_name: string
        }[]
      }
      menu_item_presentation_changed: {
        Args: { p_item_id: string; p_note: string }
        Returns: Json
      }
      menu_item_retirement_impact: {
        Args: { p_item_id: string }
        Returns: Json
      }
      menu_item_review_states: {
        Args: { p_item_ids: string[]; p_venue_id: string }
        Returns: {
          item_id: string
          rechecking: boolean
          waiting: boolean
        }[]
      }
      menu_label_counts: { Args: { p_venue_id: string }; Returns: Json }
      menu_offering_states: { Args: { p_venue_id?: string }; Returns: Json }
      menu_photo_also_counts: {
        Args: { p_asset_ids: string[]; p_venue_id: string }
        Returns: {
          asset_id: string
          credit_month: string
          item_id: string
          task_titles: string[]
          variant_id: string
        }[]
      }
      menu_special_create: {
        Args: {
          p_description: string
          p_ends_on: string
          p_kind: string
          p_name: string
          p_starts_on: string
          p_venue_id: string
        }
        Returns: Json
      }
      menu_special_decide: {
        Args: {
          p_accept: boolean
          p_reason: string
          p_revision: number
          p_special_id: string
        }
        Returns: Json
      }
      menu_special_review: {
        Args: {
          p_action: string
          p_ends_on: string
          p_reason: string
          p_revision: number
          p_special_id: string
        }
        Returns: Json
      }
      menu_specials_list: {
        Args: { p_include_archived?: boolean; p_venue_id?: string }
        Returns: Json
      }
      menu_version_activation_impact: {
        Args: { p_version_id: string }
        Returns: Json
      }
      menu_versions_for_venue: {
        Args: { p_include_archived?: boolean; p_venue_id: string }
        Returns: Json
      }
      my_area_labels: {
        Args: { p_asset_ids: string[] }
        Returns: {
          asset_id: string
          decided_at: string
          label_id: string
          reason: string
          state: string
          subject_id: string
          subject_kind: string
          subject_label: string
        }[]
      }
      my_asset_delete_impact: { Args: { p_asset_id: string }; Returns: Json }
      my_contributions_feed: {
        Args: { p_cursor: string; p_limit: number }
        Returns: Json
      }
      my_label_work: {
        Args: never
        Returns: {
          needs_attention: number
          needs_labels: number
        }[]
      }
      my_menu_waiting_items: {
        Args: { p_item_ids: string[]; p_venue_id: string }
        Returns: {
          item_id: string
          waiting: number
        }[]
      }
      my_mfa_status: { Args: never; Returns: Json }
      my_month_photos: {
        Args: { p_limit?: number; p_period_month?: string }
        Returns: {
          asset_id: string
          decided_at: string
          decided_by: string
          evidence_available: boolean
          has_preview: boolean
          has_thumbnail: boolean
          height: number
          item_names: string[]
          reason: string
          requirement_title: string
          state: string
          submission_item_id: string
          uploaded_at: string
          venue_id: string
          width: number
        }[]
      }
      my_notification_count: { Args: never; Returns: number }
      my_notification_preferences: { Args: never; Returns: Json }
      my_notifications: {
        Args: { p_before?: number; p_limit?: number }
        Returns: Json
      }
      my_onboarding_state: {
        Args: { p_notice_version: string }
        Returns: {
          notice_acknowledged_at: string
          role: string
          venue_count: number
          venue_id: string
          venue_name: string
        }[]
      }
      my_rechecks: { Args: never; Returns: Json }
      my_retake_notes: {
        Args: never
        Returns: {
          asked_at: string
          asked_by_name: string
          asset_id: string
          can_retake: boolean
          item_id: string
          item_name: string
          kind: string
          note_id: string
          note_revision: number
          reason: string
          requirement_id: string
          requirement_kind: string
          requirement_title: string
          set_aside_at: string
          status: string
          variant_id: string
          variant_name: string
        }[]
      }
      my_venue_capabilities: { Args: { p_venue_id?: string }; Returns: Json }
      my_venue_memberships: {
        Args: never
        Returns: {
          is_active_venue: boolean
          role: string
          venue_id: string
          venue_name: string
        }[]
      }
      ops_record_job_run: {
        Args: {
          p_attempts?: number
          p_detail?: Json
          p_error_code?: string
          p_job: string
          p_run_id?: string
          p_started_at?: string
          p_state: string
          p_subject_id?: string
          p_venue_id?: string
        }
        Returns: string
      }
      ops_run_notification_jobs: { Args: { p_now?: string }; Returns: Json }
      ops_settings: { Args: { p_venue_id?: string }; Returns: Json }
      ops_settings_set: {
        Args: { p_expected_revision: number; p_patch: Json; p_reason: string }
        Returns: Json
      }
      ops_status: { Args: never; Returns: Json }
      person_venue_privileges: {
        Args: { p_profile_id: string }
        Returns: {
          can_export: boolean
          can_grant_roles: boolean
          can_invite_staff: boolean
          can_review: boolean
          can_upload: boolean
          effective_role: string
          is_active_venue: boolean
          membership_id: string
          membership_role: string
          venue_id: string
          venue_name: string
        }[]
      }
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
          targets_defaulted: number
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
          targets_defaulted: number
        }[]
        SetofOptions: {
          from: "*"
          to: "coverage_preparation_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      prepare_document_cleanup: {
        Args: {
          p_abandoned_after: string
          p_exclude_ids?: string[]
          p_limit?: number
          p_now?: string
        }
        Returns: {
          document_id: string
          object_names: string[]
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
      publication_destination_save: {
        Args: {
          p_active: boolean
          p_destination_id: string
          p_expected_revision?: number
          p_label: string
          p_url: string
          p_venue_id: string
        }
        Returns: Json
      }
      publication_overview: { Args: { p_venue_id?: string }; Returns: Json }
      publication_record: {
        Args: {
          p_action: string
          p_asset_id: string
          p_destination_id: string
          p_external_ref?: string
          p_external_url?: string
          p_note?: string
          p_occurred_on: string
          p_package_id?: string
          p_request_key: string
        }
        Returns: Json
      }
      reassign_open_work: {
        Args: {
          p_from_profile_id: string
          p_reason: string
          p_to_profile_id: string
          p_venue_id: string
        }
        Returns: Json
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
      remove_venue_member: {
        Args: {
          p_profile_id: string
          p_reason: string
          p_replacement_id?: string
          p_venue_id: string
        }
        Returns: {
          active_venue_id: string
          outcome: string
          reassigned: Json
        }[]
      }
      request_media_removal: {
        Args: { p_asset_id: string; p_reason: string }
        Returns: Json
      }
      reserve_media_asset: {
        Args: {
          p_client_batch_id?: string
          p_client_upload_key?: string
          p_extension: string
          p_media_type: Database["public"]["Enums"]["media_type"]
          p_original_filename: string
          p_purpose?: string
          p_size_bytes?: number
          p_venue_id?: string
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
      review_menu_item_photo: {
        Args: {
          p_asset_id: string
          p_client_request_key?: string
          p_decision: string
          p_expected_revision: number
          p_item_id: string
          p_make_primary?: boolean
          p_reason?: string
          p_variant_id: string
        }
        Returns: {
          is_primary: boolean
          item_id: string
          item_revision: number
          photo_id: string
          replayed: boolean
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
      save_work_profile: {
        Args: {
          p_role_key: string
          p_role_title: string
          p_work_areas: string[]
        }
        Returns: {
          completed_at: string | null
          created_at: string
          role_key: string | null
          role_title: string | null
          skipped_at: string | null
          staff_id: string
          updated_at: string
          welcome_dismissed_at: string | null
          work_areas: string[]
        }
        SetofOptions: {
          from: "*"
          to: "staff_work_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      schedule_menu_version: {
        Args: {
          p_at: string
          p_expected_revision: number
          p_retirements: number
          p_version_id: string
        }
        Returns: Json
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
      set_media_area_label: {
        Args: { p_asset_id: string; p_subject_id: string }
        Returns: {
          changed: boolean
          label_id: string
          subject_id: string
        }[]
      }
      set_media_captured_at: {
        Args: { p_asset_id: string; p_captured_at: string }
        Returns: Json
      }
      set_menu_item_archived: {
        Args: { p_archived: boolean; p_item_id: string }
        Returns: undefined
      }
      set_menu_item_needed_by: {
        Args: { p_item_id: string; p_needed_by: string; p_venue_id?: string }
        Returns: {
          item_id: string
          needed_by: string
          set_at: string
          venue_id: string
        }[]
      }
      set_menu_item_photo_level: {
        Args: {
          p_asset_id: string
          p_client_request_key?: string
          p_expected_revision: number
          p_item_id: string
          p_level: string
          p_reason?: string
          p_variant_id: string
        }
        Returns: {
          is_primary: boolean
          item_id: string
          item_revision: number
          photo_id: string
          replayed: boolean
          review_level: string
          state: string
        }[]
      }
      set_menu_item_primary_photo: {
        Args: {
          p_client_request_key?: string
          p_expected_revision: number
          p_photo_id: string
        }
        Returns: {
          item_revision: number
          photo_id: string
          replayed: boolean
        }[]
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
      set_my_notification_preferences: {
        Args: { p_patch: Json }
        Returns: Json
      }
      set_retake_note_aside: {
        Args: { p_photo_id?: string; p_submission_item_id?: string }
        Returns: {
          replayed: boolean
          set_aside_at: string
        }[]
      }
      set_slot_primary_photo: {
        Args: {
          p_asset_id: string
          p_reason?: string
          p_slot_id: string
          p_slot_kind: string
        }
        Returns: Json
      }
      set_venue_default_target: {
        Args: {
          p_expected_revision?: number
          p_reason?: string
          p_target_count: number
          p_venue_id: string
        }
        Returns: {
          applied: number
          revision: number
          starts_on: string
          target_count: number
        }[]
      }
      set_welcome_dismissed: {
        Args: { p_dismissed: boolean }
        Returns: {
          completed_at: string | null
          created_at: string
          role_key: string | null
          role_title: string | null
          skipped_at: string | null
          staff_id: string
          updated_at: string
          welcome_dismissed_at: string | null
          work_areas: string[]
        }
        SetofOptions: {
          from: "*"
          to: "staff_work_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_work_profile: {
        Args: never
        Returns: {
          completed_at: string | null
          created_at: string
          role_key: string | null
          role_title: string | null
          skipped_at: string | null
          staff_id: string
          updated_at: string
          welcome_dismissed_at: string | null
          work_areas: string[]
        }
        SetofOptions: {
          from: "*"
          to: "staff_work_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stage_media_labels: {
        Args: { p_asset_id: string; p_input: Json; p_venue_id: string }
        Returns: string
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
      switch_active_venue: {
        Args: { p_venue_id: string }
        Returns: {
          role: string
          venue_id: string
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
          height: number
          media_type: Database["public"]["Enums"]["media_type"]
          uploader_id: string
          validated_mime_type: string
          venue_id: string
          width: number
        }[]
      }
      unschedule_menu_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      use_venue_default_target: {
        Args: {
          p_expected_revision: number
          p_reason: string
          p_staff_id: string
          p_venue_id: string
        }
        Returns: {
          revision: number
          source: string
          target_count: number
          target_id: string
        }[]
      }
      venue_coverage_summary: {
        Args: { p_venue_id?: string }
        Returns: {
          active_menu_version_id: string
          amenity_unknown_count: number
          applicable_count: number
          complete: boolean
          current_plan_id: string
          draft_plan_id: string
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
      venue_default_target: {
        Args: { p_venue_id: string }
        Returns: {
          revision: number
          set_at: string
          set_by: string
          starts_on: string
          target_count: number
        }[]
      }
      venue_manager_grant_list: {
        Args: { p_include_revoked?: boolean; p_venue_id?: string }
        Returns: {
          effective: boolean
          grant_id: string
          grant_reason: string
          granted_at: string
          granted_by: string
          granted_by_name: string
          revoke_kind: string
          revoke_reason: string
          revoked_at: string
          revoked_by_name: string
          staff_active: boolean
          staff_id: string
          staff_name: string
          staff_venue_id: string
          venue_id: string
          venue_name: string
        }[]
      }
      venue_scope_read: { Args: { p_venue_id?: string }; Returns: Json }
      venue_scope_set: {
        Args: {
          p_applicable: boolean
          p_key: string
          p_reason: string
          p_revision: number
          p_venue_id: string
        }
        Returns: Json
      }
      venue_team: {
        Args: { p_venue_id: string }
        Returns: {
          display_name: string
          effective_role: string
          granted_at: string
          granted_by_name: string
          is_active_venue: boolean
          job_title: string
          membership_id: string
          membership_role: string
          profile_id: string
          source: string
        }[]
      }
      withdraw_menu_item_photo: {
        Args: {
          p_client_request_key?: string
          p_expected_revision: number
          p_photo_id: string
          p_reason: string
        }
        Returns: {
          item_revision: number
          new_primary_photo_id: string
          photo_id: string
          replayed: boolean
          state: string
        }[]
      }
    }
    Enums: {
      app_role: "staff" | "admin" | "manager"
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
      app_role: ["staff", "admin", "manager"],
      media_type: ["image", "video"],
      upload_state: ["uploading", "processing", "ready", "failed"],
    },
  },
} as const
