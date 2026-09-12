export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      profiles: { Row: { id: string; full_name: string | null; created_at: string }; Insert: { id: string; full_name?: string | null; created_at?: string }; Update: { id?: string; full_name?: string | null; created_at?: string }; Relationships: [] };
      agents: { Row: { id: string; user_id: string; name: string; description: string | null; system_prompt: string | null; status: string; created_at: string; updated_at: string }; Insert: { id?: string; user_id: string; name: string; description?: string | null; system_prompt?: string | null; status?: string; created_at?: string; updated_at?: string }; Update: { id?: string; user_id?: string; name?: string; description?: string | null; system_prompt?: string | null; status?: string; created_at?: string; updated_at?: string }; Relationships: [] };
      calls: { Row: { id: string; user_id: string; agent_id: string | null; phone_number: string; contact_name: string | null; calle_call_id: string | null; status: string; started_at: string | null; ended_at: string | null; duration_seconds: number | null; created_at: string }; Insert: { id?: string; user_id: string; agent_id?: string | null; phone_number: string; contact_name?: string | null; calle_call_id?: string | null; status?: string; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; created_at?: string }; Update: { id?: string; user_id?: string; agent_id?: string | null; phone_number?: string; contact_name?: string | null; calle_call_id?: string | null; status?: string; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; created_at?: string }; Relationships: [{ foreignKeyName: "calls_agent_id_fkey"; columns: ["agent_id"]; isOneToOne: false; referencedRelation: "agents"; referencedColumns: ["id"] }] };
      call_results: { Row: { id: string; call_id: string; outcome: string | null; summary: string | null; structured_result: Json | null; transcript: string | null; created_at: string }; Insert: { id?: string; call_id: string; outcome?: string | null; summary?: string | null; structured_result?: Json | null; transcript?: string | null; created_at?: string }; Update: { id?: string; call_id?: string; outcome?: string | null; summary?: string | null; structured_result?: Json | null; transcript?: string | null; created_at?: string }; Relationships: [{ foreignKeyName: "call_results_call_id_fkey"; columns: ["call_id"]; isOneToOne: true; referencedRelation: "calls"; referencedColumns: ["id"] }] };
      agent_connections: { Row: { id: string; user_id: string; agent_id: string; token_hash: string; token_prefix: string; host: string; created_at: string; last_used_at: string | null; revoked_at: string | null }; Insert: { id?: string; user_id: string; agent_id: string; token_hash: string; token_prefix: string; host?: string; created_at?: string; last_used_at?: string | null; revoked_at?: string | null }; Update: { revoked_at?: string | null; last_used_at?: string | null }; Relationships: [] };
      agent_messages: { Row: { id: string; user_id: string; agent_id: string; body: string; created_at: string; consumed_at: string | null }; Insert: { id?: string; user_id: string; agent_id: string; body: string; created_at?: string; consumed_at?: string | null }; Update: { consumed_at?: string | null }; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      cya_create_agent_connection: { Args: { p_agent_id: string; p_host?: string }; Returns: { token: string; tokenPrefix: string } };
      cya_revoke_agent_connection: { Args: { p_agent_id: string }; Returns: undefined };
      cya_agent_authorize: { Args: { p_token: string }; Returns: { agent_id: string; user_id: string; agent_name: string; description: string | null; system_prompt: string | null; status: string }[] };
      cya_agent_create_call: { Args: { p_token: string; p_phone_number: string; p_contact_name: string; p_context: string }; Returns: { call_id: string; agent_id: string; user_id: string; agent_name: string; description: string | null; system_prompt: string | null }[] };
      cya_agent_update_call: { Args: { p_token: string; p_call_id: string; p_calle_call_id: string | null; p_status: string; p_started_at?: string | null; p_ended_at?: string | null; p_duration_seconds?: number | null; p_outcome?: string | null; p_summary?: string | null; p_structured_result?: Json | null; p_transcript?: string | null }; Returns: undefined };
      cya_agent_get_call: { Args: { p_token: string; p_call_id: string }; Returns: Json };
      cya_agent_pull_messages: { Args: { p_token: string }; Returns: { id: string; body: string; created_at: string }[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
