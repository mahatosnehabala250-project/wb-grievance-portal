-- ============================================
-- West Bengal Grievance Portal - Seed Data
-- Run AFTER migration.sql
-- ============================================

-- Passwords are bcrypt hashed (12 rounds)
-- admin123, state123, nadia123, purulia123, bankura123
-- krish123, rana123, kalyani123, psadar123, raghunath123, bsadar123, bishnu123

INSERT INTO users (id, username, "passwordHash", role, name, location, district) VALUES
('u_admin_001', 'admin', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'ADMIN', 'System Administrator', 'West Bengal', NULL),
('u_state_001', 'state_wb', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'STATE', 'Arun Kumar Sharma', 'West Bengal', NULL),
('u_dist_001', 'district_nadia', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'DISTRICT', 'Dr. Sujata Mukherjee', 'Nadia', 'Nadia'),
('u_dist_002', 'district_purulia', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'DISTRICT', 'Rabindra Nath Maity', 'Purulia', 'Purulia'),
('u_dist_003', 'district_bankura', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'DISTRICT', 'Tanmoy Ghosh', 'Bankura', 'Bankura'),
('u_block_001', 'block_krishnanagar', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Bipul Das', 'Krishnanagar', 'Nadia'),
('u_block_002', 'block_ranaghat', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Mita Rani Sarkar', 'Ranaghat', 'Nadia'),
('u_block_003', 'block_kalyani', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Sunil Karmakar', 'Kalyani', 'Nadia'),
('u_block_004', 'block_purulia_sadar', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Amiya Mahato', 'Purulia Sadar', 'Purulia'),
('u_block_005', 'block_raghunathpur', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Sujit Tudu', 'Raghunathpur', 'Purulia'),
('u_block_006', 'block_bankura_sadar', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Prasanta Mondal', 'Bankura Sadar', 'Bankura'),
('u_block_007', 'block_bishnupur', '$2b$12$LJ3m4ys3DkGK1nY3qG7PLe4r3T9YQnWBxBmFXL/otIxQw8pFnTKue', 'BLOCK', 'Anita Dhibar', 'Bishnupur', 'Bankura')
ON CONFLICT (username) DO NOTHING;
