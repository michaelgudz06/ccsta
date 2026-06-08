export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      buses: {
        Row: {
          active: boolean
          air_brake_req: boolean
          bench_count: number
          created_at: string
          fleet_number: string
          home_yard_id: string | null
          id: string
          notes: string | null
          samsara_vehicle_id: string | null
          serial_number: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          air_brake_req?: boolean
          bench_count: number
          created_at?: string
          fleet_number: string
          home_yard_id?: string | null
          id?: string
          notes?: string | null
          samsara_vehicle_id?: string | null
          serial_number?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          air_brake_req?: boolean
          bench_count?: number
          created_at?: string
          fleet_number?: string
          home_yard_id?: string | null
          id?: string
          notes?: string | null
          samsara_vehicle_id?: string | null
          serial_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buses_home_yard_id_fkey"
            columns: ["home_yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_availability: {
        Row: {
          created_at: string
          date: string
          driver_id: string
          id: string
          note: string | null
          status: Database["public"]["Enums"]["availability_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          driver_id: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          driver_id?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_availability_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_bus_clearances: {
        Row: {
          bench_count: number
          driver_id: string
        }
        Insert: {
          bench_count: number
          driver_id: string
        }
        Update: {
          bench_count?: number
          driver_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_bus_clearances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_no_pair_constraints: {
        Row: {
          created_at: string
          driver_a_id: string
          driver_b_id: string
          id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          driver_a_id: string
          driver_b_id: string
          id?: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          driver_a_id?: string
          driver_b_id?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_no_pair_constraints_driver_a_id_fkey"
            columns: ["driver_a_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_no_pair_constraints_driver_b_id_fkey"
            columns: ["driver_b_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active: boolean
          air_brake_cert: boolean
          created_at: string
          email: string | null
          first_name: string
          home_yard_id: string | null
          id: string
          last_name: string
          notes: string | null
          phone: string | null
          profile_id: string | null
          samsara_driver_id: string | null
          trip_type: Database["public"]["Enums"]["driver_trip_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          air_brake_cert?: boolean
          created_at?: string
          email?: string | null
          first_name: string
          home_yard_id?: string | null
          id?: string
          last_name: string
          notes?: string | null
          phone?: string | null
          profile_id?: string | null
          samsara_driver_id?: string | null
          trip_type?: Database["public"]["Enums"]["driver_trip_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          air_brake_cert?: boolean
          created_at?: string
          email?: string | null
          first_name?: string
          home_yard_id?: string | null
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string | null
          profile_id?: string | null
          samsara_driver_id?: string | null
          trip_type?: Database["public"]["Enums"]["driver_trip_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_home_yard_id_fkey"
            columns: ["home_yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          due_date: string | null
          id: string
          invoice_number: string
          issued_date: string | null
          notes: string | null
          paid_at: string | null
          quote_id: string | null
          sage_export_data: Json | null
          school_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number: string
          issued_date?: string | null
          notes?: string | null
          paid_at?: string | null
          quote_id?: string | null
          sage_export_data?: Json | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount?: number
          total: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          issued_date?: string | null
          notes?: string | null
          paid_at?: string | null
          quote_id?: string | null
          sage_export_data?: Json | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_records: {
        Row: {
          created_at: string
          driver_id: string
          gross_pay: number | null
          hourly_rate_snapshot: number | null
          hours_category: string | null
          hours_worked: number
          id: string
          notes: string | null
          pay_period_end: string
          pay_period_start: string
          status: Database["public"]["Enums"]["payroll_status"]
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          gross_pay?: number | null
          hourly_rate_snapshot?: number | null
          hours_category?: string | null
          hours_worked?: number
          id?: string
          notes?: string | null
          pay_period_end: string
          pay_period_start: string
          status?: Database["public"]["Enums"]["payroll_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          gross_pay?: number | null
          hourly_rate_snapshot?: number | null
          hours_category?: string | null
          hours_worked?: number
          id?: string
          notes?: string | null
          pay_period_end?: string
          pay_period_start?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_records_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_records_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      quote_versions: {
        Row: {
          adults_count: number | null
          cargo_needed: boolean
          contact_day_of: Json | null
          contact_primary: Json | null
          contact_secondary: Json | null
          created_at: string
          created_by: string | null
          customer_notes: string | null
          departure_time: string | null
          destination_address: string | null
          destination_name: string | null
          estimated_hours: number | null
          grade_breakdown: Json | null
          id: string
          internal_notes: string | null
          pickup_address: string | null
          quote_id: string
          rate_snapshot: Json | null
          return_time: string | null
          special_requests: string | null
          student_count: number | null
          subtotal: number | null
          suggested_bus_id: string | null
          suggested_driver_id: string | null
          surcharge_snapshot: Json | null
          surcharge_total: number | null
          total: number | null
          trip_date: string | null
          version_number: number
        }
        Insert: {
          adults_count?: number | null
          cargo_needed?: boolean
          contact_day_of?: Json | null
          contact_primary?: Json | null
          contact_secondary?: Json | null
          created_at?: string
          created_by?: string | null
          customer_notes?: string | null
          departure_time?: string | null
          destination_address?: string | null
          destination_name?: string | null
          estimated_hours?: number | null
          grade_breakdown?: Json | null
          id?: string
          internal_notes?: string | null
          pickup_address?: string | null
          quote_id: string
          rate_snapshot?: Json | null
          return_time?: string | null
          special_requests?: string | null
          student_count?: number | null
          subtotal?: number | null
          suggested_bus_id?: string | null
          suggested_driver_id?: string | null
          surcharge_snapshot?: Json | null
          surcharge_total?: number | null
          total?: number | null
          trip_date?: string | null
          version_number: number
        }
        Update: {
          adults_count?: number | null
          cargo_needed?: boolean
          contact_day_of?: Json | null
          contact_primary?: Json | null
          contact_secondary?: Json | null
          created_at?: string
          created_by?: string | null
          customer_notes?: string | null
          departure_time?: string | null
          destination_address?: string | null
          destination_name?: string | null
          estimated_hours?: number | null
          grade_breakdown?: Json | null
          id?: string
          internal_notes?: string | null
          pickup_address?: string | null
          quote_id?: string
          rate_snapshot?: Json | null
          return_time?: string | null
          special_requests?: string | null
          student_count?: number | null
          subtotal?: number | null
          suggested_bus_id?: string | null
          suggested_driver_id?: string | null
          surcharge_snapshot?: Json | null
          surcharge_total?: number | null
          total?: number | null
          trip_date?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_suggested_bus_id_fkey"
            columns: ["suggested_bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_suggested_driver_id_fkey"
            columns: ["suggested_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          current_version_id: string | null
          customer_id: string
          id: string
          quote_number: string
          school_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          customer_id: string
          id?: string
          quote_number: string
          school_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          customer_id?: string
          id?: string
          quote_number?: string
          school_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_config: {
        Row: {
          bench_count: number
          created_at: string
          hourly_rate: number
          id: string
          label: string
          min_charge: number
          min_hours: number
          updated_at: string
        }
        Insert: {
          bench_count: number
          created_at?: string
          hourly_rate: number
          id?: string
          label: string
          min_charge: number
          min_hours?: number
          updated_at?: string
        }
        Update: {
          bench_count?: number
          created_at?: string
          hourly_rate?: number
          id?: string
          label?: string
          min_charge?: number
          min_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      schools: {
        Row: {
          address: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          district: string | null
          id: string
          is_member: boolean
          name: string
          notes: string | null
          postal_code: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_member?: boolean
          name: string
          notes?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_member?: boolean
          name?: string
          notes?: string | null
          postal_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      surcharge_config: {
        Row: {
          description: string | null
          key: string
          unit: string
          updated_at: string
          value: number
        }
        Insert: {
          description?: string | null
          key: string
          unit: string
          updated_at?: string
          value: number
        }
        Update: {
          description?: string | null
          key?: string
          unit?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      trips: {
        Row: {
          actual_departure: string | null
          actual_return: string | null
          admin_notes: string | null
          bus_id: string | null
          created_at: string
          departure_time: string | null
          destination_address: string | null
          destination_name: string | null
          driver_id: string | null
          driver_notes: string | null
          id: string
          odometer_end: number | null
          odometer_start: number | null
          quote_id: string | null
          quote_version_id: string | null
          return_time: string | null
          school_id: string | null
          status: Database["public"]["Enums"]["trip_status"]
          student_count: number | null
          trip_date: string
          trip_number: string
          updated_at: string
        }
        Insert: {
          actual_departure?: string | null
          actual_return?: string | null
          admin_notes?: string | null
          bus_id?: string | null
          created_at?: string
          departure_time?: string | null
          destination_address?: string | null
          destination_name?: string | null
          driver_id?: string | null
          driver_notes?: string | null
          id?: string
          odometer_end?: number | null
          odometer_start?: number | null
          quote_id?: string | null
          quote_version_id?: string | null
          return_time?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          student_count?: number | null
          trip_date: string
          trip_number: string
          updated_at?: string
        }
        Update: {
          actual_departure?: string | null
          actual_return?: string | null
          admin_notes?: string | null
          bus_id?: string | null
          created_at?: string
          departure_time?: string | null
          destination_address?: string | null
          destination_name?: string | null
          driver_id?: string | null
          driver_notes?: string | null
          id?: string
          odometer_end?: number | null
          odometer_start?: number | null
          quote_id?: string | null
          quote_version_id?: string | null
          return_time?: string | null
          school_id?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          student_count?: number | null
          trip_date?: string
          trip_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "buses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_quote_version_id_fkey"
            columns: ["quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      yards: {
        Row: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          lat: number | null
          lng: number | null
          name: string
          samsara_geofence_id: string | null
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_default?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          samsara_geofence_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_default?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          samsara_geofence_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_quote: {
        Args: { p_quote_id: string; p_invoice_number?: string | null }
        Returns: Json
      }
      confirm_trip: {
        Args: { p_quote_id: string; p_driver_id: string; p_bus_id: string }
        Returns: Json
      }
      reject_quote: {
        Args: { p_quote_id: string; p_reason?: string | null }
        Returns: Json
      }
      submit_quote: {
        Args: { p_data: Json }
        Returns: Json
      }
      suggest_assignment: {
        Args: { p_quote_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "customer" | "driver" | "admin"
      availability_status: "available" | "unavailable" | "unknown"
      driver_trip_type: "route" | "field_trip" | "both"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "cancelled"
      payroll_status: "draft" | "processed" | "paid"
      quote_status:
        | "requested"
        | "in_review"
        | "approved"
        | "confirmed"
        | "scheduled"
        | "completed"
        | "invoiced"
        | "cancelled"
      trip_status: "scheduled" | "in_progress" | "completed" | "cancelled"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][CompositeTypeName]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["customer", "driver", "admin"],
      availability_status: ["available", "unavailable", "unknown"],
      driver_trip_type: ["route", "field_trip", "both"],
      invoice_status: ["draft", "sent", "paid", "overdue", "cancelled"],
      payroll_status: ["draft", "processed", "paid"],
      quote_status: [
        "requested",
        "in_review",
        "approved",
        "confirmed",
        "scheduled",
        "completed",
        "invoiced",
        "cancelled",
      ],
      trip_status: ["scheduled", "in_progress", "completed", "cancelled"],
    },
  },
} as const
