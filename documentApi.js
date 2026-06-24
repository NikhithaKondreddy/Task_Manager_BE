


class DocumentAPI {
  constructor(baseURL) {
    const nodeEnvBase = (typeof process !== 'undefined' && process.env)
      ? (process.env.BASE_URL ? `${process.env.BASE_URL}/api` : null)
      : null;
    const globalOverride = (typeof window !== 'undefined' && window.__BACKEND_BASE_URL) ? window.__BACKEND_BASE_URL : null;
    const defaultBase = nodeEnvBase || globalOverride;
    if (!defaultBase) {
      throw new Error('BASE_URL environment variable is required');
    }
    this.baseURL = baseURL || defaultBase;
  }

  getHeaders(includeContentType = true) {
    const token = localStorage.getItem('token');
    const headers = {
      'Authorization': token ? `Bearer ${token}` : ''
    };
    if (includeContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  async handleResponse(response) {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async uploadDocument(file, options = {}) {
    const formData = new FormData();
    formData.append('document', file);
    if (options.entityType) formData.append('entityType', options.entityType);
    if (options.entityId) formData.append('entityId', options.entityId);
    if (options.projectId) formData.append('projectId', options.projectId);
    if (options.clientId) formData.append('clientId', options.clientId);
    if (options.taskId) formData.append('taskId', options.taskId);

    const response = await fetch(`${this.baseURL}/documents/upload`, {
      method: 'POST',
      headers: { 'Authorization': this.getHeaders(false).Authorization }, // No Content-Type for FormData
      body: formData
    });
    return this.handleResponse(response);
  }

  async listDocuments(params = {}) {
    const query = new URLSearchParams();
    if (params.projectId) query.append('projectId', params.projectId);
    if (params.clientId) query.append('clientId', params.clientId);
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);

    const response = await fetch(`${this.baseURL}/documents?${query}`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    return this.handleResponse(response);
  }

  async previewDocument(documentId) {
    const response = await fetch(`${this.baseURL}/documents/${documentId}/preview`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    const data = await this.handleResponse(response);

    // Convert relative URL to absolute if needed
    if (data.previewUrl && !data.previewUrl.startsWith('http')) {
      const baseUrl = new URL(this.baseURL).origin;
      data.previewUrl = `${baseUrl}${data.previewUrl}`;
    }

    return data;
  }

  /**
   * Opens a document preview in a new tab or modal based on file type
   * @param {string} documentId - The document ID
   * @param {Object} options - Config for preview behavior
   * @param {string} options.target - 'tab' (default) or 'modal'
   * @returns {Promise<void>}
   */
  async openPreview(documentId, options = {}) {
    const { target = 'tab' } = options;

    const data = await this.previewDocument(documentId);
    const { previewUrl, mimeType, fileName } = data;

    if (!previewUrl) throw new Error('No preview URL available');

    if (target === 'modal') {
      // Return data for modal handling in React component
      return {
        url: previewUrl,
        mimeType,
        fileName,
        isPdf: mimeType === 'application/pdf',
        isImage: mimeType.startsWith('image/'),
        isVideo: mimeType.startsWith('video/'),
        isIFrame: mimeType === 'application/pdf' || mimeType.startsWith('image/')
      };
    } else {
      // Open in new tab (standard behavior)
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async downloadDocument(documentId) {
    const response = await fetch(`${this.baseURL}/documents/${documentId}/download`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.headers.get('Content-Disposition')?.split('filename=')[1] || 'file';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async assignAccess(documentId, assigneeIds, permissionLevel) {
    const payload = {
      documentId,
      assigneeIds: Array.isArray(assigneeIds) ? assigneeIds : [assigneeIds],
      permissionLevel
    };
    const response = await fetch(`${this.baseURL}/documents/access`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });
    return this.handleResponse(response);
  }

  async assignAccessSingle(documentId, assigneeId, accessType) {
    const payload = {
      assigneeId,
      accessType
    };
    const response = await fetch(`${this.baseURL}/documents/${documentId}/assign-access`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });
    return this.handleResponse(response);
  }

  async getMyDocuments() {
    const response = await fetch(`${this.baseURL}/documents/my`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    return this.handleResponse(response);
  }

  async getProjectMembers(projectId) {
    const response = await fetch(`${this.baseURL}/documents/project/${projectId}/members`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    return this.handleResponse(response);
  }

  async getNotifications(limit = 50, offset = 0) {
    const response = await fetch(`${this.baseURL}/notifications?limit=${limit}&offset=${offset}`, {
      method: 'GET',
      headers: this.getHeaders()
    });
    return this.handleResponse(response);
  }

  async markNotificationRead(notificationId) {
    const response = await fetch(`${this.baseURL}/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: this.getHeaders()
    });
    return this.handleResponse(response);
  }
}

export default DocumentAPI;