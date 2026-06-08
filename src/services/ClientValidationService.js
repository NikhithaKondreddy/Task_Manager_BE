

class ClientValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ClientValidationError';
    this.details = details;
  }
}


function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}


function validatePhone(phone) {
  const phoneRegex = /^[\d\s\-\+\(\)]+$|^$/;
  return phoneRegex.test(phone) && (phone.length === 0 || phone.replace(/\D/g, '').length >= 10);
}


function validateGST(gst) {
  if (!gst) return true; // Optional field
  const gstRegex = /^[0-9A-Z]{15}$/;
  return gstRegex.test(gst);
}


function validateCreateClientDTO(data) {
  const errors = {};

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.name = 'Client name is required and must be a non-empty string';
  }

  if (!data.company || typeof data.company !== 'string' || data.company.trim().length === 0) {
    errors.company = 'Company name is required and must be a non-empty string';
  }

  if (data.email && !validateEmail(data.email)) {
    errors.email = 'Invalid email format';
  }

  if (data.phone && !validatePhone(data.phone)) {
    errors.phone = 'Invalid phone format';
  }

  if (data.gstNumber && !validateGST(data.gstNumber)) {
    errors.gstNumber = 'Invalid GST number format (should be 15 alphanumeric characters)';
  }

  const validStatuses = ['Active', 'Inactive', 'On Hold', 'Closed'];
  if (data.status && !validStatuses.includes(data.status)) {
    errors.status = `Status must be one of: ${validStatuses.join(', ')}`;
  }

  if (data.contacts && Array.isArray(data.contacts)) {
    const contactErrors = [];
    data.contacts.forEach((contact, idx) => {
      const contactError = {};
      if (!contact.name) contactError.name = 'Contact name is required';
      if (contact.email && !validateEmail(contact.email)) contactError.email = 'Invalid email format';
      if (contact.phone && !validatePhone(contact.phone)) contactError.phone = 'Invalid phone format';
      if (Object.keys(contactError).length > 0) {
        contactErrors.push({ index: idx, errors: contactError });
      }
    });
    if (contactErrors.length > 0) {
      errors.contacts = contactErrors;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ClientValidationError('Client validation failed', errors);
  }

  return true;
}


function validateUpdateClientDTO(data) {
  const errors = {};
  const allowedFields = [
    'name', 'company', 'billingAddress', 'officeAddress',
    'gstNumber', 'taxId', 'industry', 'notes', 'status',
    'bankDetails', 'email', 'phone', 'district', 'pincode', 'state'
  ];

  for (const key of Object.keys(data)) {
    if (!allowedFields.includes(key) && key !== 'id') {
      errors[key] = 'This field cannot be updated';
    }
  }

  if (data.email && !validateEmail(data.email)) {
    errors.email = 'Invalid email format';
  }

  if (data.phone && !validatePhone(data.phone)) {
    errors.phone = 'Invalid phone format';
  }

  if (data.gstNumber && !validateGST(data.gstNumber)) {
    errors.gstNumber = 'Invalid GST number format';
  }

  if (data.status) {
    const validStatuses = ['Active', 'Inactive', 'On Hold', 'Closed'];
    if (!validStatuses.includes(data.status)) {
      errors.status = `Status must be one of: ${validStatuses.join(', ')}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ClientValidationError('Update validation failed', errors);
  }

  return true;
}


function validateContactDTO(contact) {
  const errors = {};

  if (!contact.name || typeof contact.name !== 'string' || contact.name.trim().length === 0) {
    errors.name = 'Contact name is required';
  }

  if (contact.email && !validateEmail(contact.email)) {
    errors.email = 'Invalid email format';
  }

  if (contact.phone && !validatePhone(contact.phone)) {
    errors.phone = 'Invalid phone format';
  }

  if (Object.keys(errors).length > 0) {
    throw new ClientValidationError('Contact validation failed', errors);
  }

  return true;
}


function sanitizeClientData(data) {
  const sanitized = { ...data };

  delete sanitized.id;
  delete sanitized.ref;
  delete sanitized.createdAt;
  delete sanitized.created_at;
  delete sanitized.created_by;
  return sanitized;
}

module.exports = {
  ClientValidationError,
  validateEmail,
  validatePhone,
  validateGST,
  validateCreateClientDTO,
  validateUpdateClientDTO,
  validateContactDTO,
  sanitizeClientData,
  VALID_STATUSES: ['Active', 'Inactive', 'On Hold', 'Closed']
};
