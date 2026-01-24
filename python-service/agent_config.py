"""
Price Agent Configuration
Loads configuration from environment variables
"""

import os
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.local')


@dataclass
class AgentConfig:
    """Configuration for price agent"""
    
    # Agent identity
    agent_id: str
    
    # Server connection
    server_url: str
    api_key: str
    
    # IB TWS connection (local)
    ib_host: str = "127.0.0.1"
    ib_port: int = 7497
    ib_client_id: int = 100
    
    @classmethod
    def from_env(cls) -> 'AgentConfig':
        """Load configuration from environment variables"""
        
        agent_id = os.getenv('AGENT_ID')
        if not agent_id:
            raise ValueError("AGENT_ID must be set in .env.local")
        
        server_url = os.getenv('SERVER_URL')
        if not server_url:
            raise ValueError("SERVER_URL must be set in .env.local")
        
        api_key = os.getenv('AGENT_API_KEY')
        if not api_key:
            raise ValueError("AGENT_API_KEY must be set in .env.local")
        
        return cls(
            agent_id=agent_id,
            server_url=server_url,
            api_key=api_key,
            ib_host=os.getenv('IB_HOST', '127.0.0.1'),
            ib_port=int(os.getenv('IB_PORT', '7497')),
            ib_client_id=int(os.getenv('IB_CLIENT_ID', '100')),
        )
    
    def validate(self) -> None:
        """Validate configuration"""
        if not self.agent_id:
            raise ValueError("agent_id cannot be empty")
        
        if not self.server_url:
            raise ValueError("server_url cannot be empty")
        
        if not self.api_key:
            raise ValueError("api_key cannot be empty")
        
        if not self.server_url.startswith(('http://', 'https://')):
            raise ValueError("server_url must start with http:// or https://")
        
        if self.ib_port < 1 or self.ib_port > 65535:
            raise ValueError("ib_port must be between 1 and 65535")

